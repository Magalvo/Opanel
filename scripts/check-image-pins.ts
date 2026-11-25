// Reads the images the example install pulls, and the Dockerfile's base, each pinned by
// digest (WS-062, WS-067, WS-126). Run weekly by the Dependency audit workflow:
// `pnpm exec tsx scripts/check-image-pins.ts` fails once a pinned tag resolves to another
// digest, so a pin cannot hold back security updates unnoticed (see CONTRIBUTING.md,
// "Image pins"). It needs Docker with buildx, and reads only manifests from the registry.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { read } from "./doc-checks";

const SERVICES_FILE = "docker/production/services.yaml";
const DOCKERFILE = "Dockerfile";
const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** An image reference split into its parts; `digest` is null for a floating tag. */
export interface Image {
  readonly reference: string;
  readonly repository: string;
  readonly tag: string;
  readonly digest: string | null;
}

/** An image the repository pulls, and where it is named. */
export interface ImagePin extends Image {
  readonly source: string;
}

export function parseImage(reference: string): Image {
  const [name = "", digest = null] = reference.split("@");
  if (digest !== null && !DIGEST.test(digest)) {
    throw new Error(`${reference}: the digest is not sha256 and 64 hex digits.`);
  }
  // The tag follows the last colon after the last slash (a registry may have a port).
  const colon = name.lastIndexOf(":");
  const hasTag = colon > name.lastIndexOf("/");
  return {
    reference,
    repository: hasTag ? name.slice(0, colon) : name,
    tag: hasTag ? name.slice(colon + 1) : "latest",
    digest,
  };
}

/** A service of a Compose file: its image, and whether Compose builds it. */
export interface ComposeService {
  readonly service: string;
  readonly image: string;
  readonly built: boolean;
}

interface Keys {
  image?: string;
  build?: boolean;
  merge?: string;
}

function value(line: string): string {
  const raw = line.slice(line.indexOf(":") + 1).replace(/\s+#.*$/, "");
  return raw.trim().replace(/^["']|["']$/g, "");
}

/**
 * Reads the `services:` of a Compose file line by line (no YAML parser is a dependency):
 * each service's `image:` and `build:`, following a `<<: *anchor` merge of a top-level
 * block. Throws for a service with neither, so a layout it does not understand is noticed.
 */
export function composeServices(yaml: string): ComposeService[] {
  const anchors = new Map<string, Keys>();
  const services = new Map<string, Keys>();
  let current: Keys | null = null;
  let inServices = false;

  for (const line of yaml.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const topLevel = /^([A-Za-z][\w-]*):\s*(?:&([\w-]+))?\s*$/.exec(line);
    if (topLevel) {
      inServices = topLevel[1] === "services";
      current = null;
      if (topLevel[2]) {
        current = {};
        anchors.set(topLevel[2], current);
      }
      continue;
    }
    const service = /^ {2}([\w-]+):\s*$/.exec(line);
    if (inServices && service?.[1]) {
      current = {};
      services.set(service[1], current);
      continue;
    }
    const indent = inServices ? 4 : 2;
    const key = new RegExp(`^ {${String(indent)}}(image|build|<<):`).exec(line);
    if (!current || !key) continue;
    if (key[1] === "image") current.image = value(line);
    if (key[1] === "build") current.build = true;
    if (key[1] === "<<") current.merge = value(line).replace(/^\*/, "");
  }

  return [...services].map(([name, keys]) => {
    const merged = keys.merge ? anchors.get(keys.merge) : undefined;
    const image = keys.image ?? merged?.image;
    const built = keys.build ?? merged?.build ?? false;
    if (image === undefined) {
      throw new Error(`The service ${name} has neither image: nor build: that can be read.`);
    }
    return { service: name, image, built };
  });
}

/** The pulled images of the services file and the `ARG …_IMAGE=` defaults of the Dockerfile. */
export function imagePins(files: { services: string; dockerfile: string }): ImagePin[] {
  const services = composeServices(files.services)
    .filter((service) => !service.built)
    .map((service) => ({
      source: `${SERVICES_FILE}, ${service.service}`,
      ...parseImage(service.image),
    }));
  const bases = [...files.dockerfile.matchAll(/^ARG ([A-Z0-9_]+_IMAGE)=(\S+)\s*$/gm)].map(
    (match) => ({ source: `${DOCKERFILE}, ${match[1] ?? ""}`, ...parseImage(match[2] ?? "") }),
  );
  return [...services, ...bases];
}

export function repositoryPins(): ImagePin[] {
  return imagePins({ services: read(SERVICES_FILE), dockerfile: read(DOCKERFILE) });
}

export interface StalePin {
  readonly source: string;
  readonly image: string;
  readonly pinned: string | null;
  readonly current: string;
}

/** Each pin whose `repository:tag` now resolves to another digest than the pinned one. */
export function stalePins(
  pins: readonly ImagePin[],
  resolved: ReadonlyMap<string, string>,
): StalePin[] {
  return pins.flatMap((pin) => {
    const image = `${pin.repository}:${pin.tag}`;
    const current = resolved.get(image);
    if (current === undefined) throw new Error(`No digest was resolved for ${image}.`);
    return current === pin.digest
      ? []
      : [{ source: pin.source, image, pinned: pin.digest, current }];
  });
}

const manifestSchema = z.object({ digest: z.string().regex(DIGEST) });

/** The digest in the output of `docker buildx imagetools inspect --format '{{json .Manifest}}'`. */
export function manifestDigest(output: string): string {
  return manifestSchema.parse(JSON.parse(output)).digest;
}

/** The leading number of a tag (`18-alpine` → 18), or null. */
export function tagMajor(tag: string): number | null {
  const match = /^(\d+)/.exec(tag);
  return match?.[1] ? Number(match[1]) : null;
}

/** The major version of `.nvmrc` (`22`, `v22.1.0` → 22), or null for an alias such as `lts/*`. */
export function nvmrcMajor(nvmrc: string): number | null {
  const match = /^v?(\d+)/.exec(nvmrc.trim());
  return match?.[1] ? Number(match[1]) : null;
}

/** The major version of the guide's line "- `db`: PostgreSQL NN …", or null. */
export function guideDatabaseMajor(guide: string): number | null {
  const match = /^- `db`: PostgreSQL (\d+)\b/m.exec(guide);
  return match?.[1] ? Number(match[1]) : null;
}

function resolve(image: string): string {
  const output = execFileSync(
    "docker",
    ["buildx", "imagetools", "inspect", image, "--format", "{{json .Manifest}}"],
    { encoding: "utf8" },
  );
  return manifestDigest(output);
}

function main(): void {
  const pins = repositoryPins();
  const images = [...new Set(pins.map((pin) => `${pin.repository}:${pin.tag}`))];
  const resolved = new Map(images.map((image) => [image, resolve(image)]));
  const stale = stalePins(pins, resolved);
  for (const pin of stale) {
    console.error(
      `${pin.image} (${pin.source}) now resolves to ${pin.current}, pinned ${pin.pinned ?? "nowhere"}: ` +
        'update the pin, see CONTRIBUTING.md, "Image pins".',
    );
  }
  if (stale.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.warn(`Pinned images are current: ${images.join(", ")}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
