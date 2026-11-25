import { describe, expect, it } from "vitest";

import {
  composeServices,
  guideDatabaseMajor,
  imagePins,
  manifestDigest,
  nvmrcMajor,
  parseImage,
  repositoryPins,
  stalePins,
  tagMajor,
} from "./check-image-pins";
import { read } from "./doc-checks";

const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER = `sha256:${"b".repeat(64)}`;

describe("parseImage (WS-126)", () => {
  it("splits a pinned reference into repository, tag and digest", () => {
    expect(parseImage(`postgres:18-alpine@${DIGEST}`)).toEqual({
      reference: `postgres:18-alpine@${DIGEST}`,
      repository: "postgres",
      tag: "18-alpine",
      digest: DIGEST,
    });
  });

  it("gives a floating tag no digest, and keeps a registry with a port", () => {
    expect(parseImage("registry.example.com:5000/team/db:1")).toEqual({
      reference: "registry.example.com:5000/team/db:1",
      repository: "registry.example.com:5000/team/db",
      tag: "1",
      digest: null,
    });
  });

  it("refuses a digest that is not sha256 and 64 hex digits", () => {
    expect(() => parseImage("postgres:18@sha256:abc")).toThrow(/digest/);
  });
});

describe("composeServices (WS-126)", () => {
  const yaml = [
    "x-app: &app",
    "  build: .",
    "  image: opanel-app:local",
    "  logging: *logging",
    "",
    "services:",
    "  db:",
    `    image: postgres:18-alpine@${DIGEST} # a comment`,
    "    environment:",
    "      image: not-this-one",
    "",
    "  app:",
    "    <<: *app",
    "    restart: unless-stopped",
    "",
    "  proxy:",
    '    image: "caddy:2-alpine"',
    "",
    "volumes:",
    "  db-data:",
  ].join("\r\n");

  it("reads each service's image, following a merged anchor and marking built ones", () => {
    expect(composeServices(yaml)).toEqual([
      { service: "db", image: `postgres:18-alpine@${DIGEST}`, built: false },
      { service: "app", image: "opanel-app:local", built: true },
      { service: "proxy", image: "caddy:2-alpine", built: false },
    ]);
  });

  it("refuses a service with neither image nor build", () => {
    expect(() => composeServices("services:\n  db:\n    restart: always\n")).toThrow(
      /db has neither image: nor build:/,
    );
  });
});

describe("imagePins (WS-126)", () => {
  it("lists the pulled images of the services and the Dockerfile's base images", () => {
    const services = [
      "x-app: &app",
      "  build: .",
      "  image: opanel-app:local",
      "services:",
      "  db:",
      "    image: postgres:18-alpine",
      "  app:",
      "    <<: *app",
    ].join("\n");
    const dockerfile = [
      "# syntax=docker/dockerfile:1",
      `ARG NODE_IMAGE=node:22-bookworm-slim@${DIGEST}`,
      "ARG OTHER=1",
      "FROM ${NODE_IMAGE} AS base",
    ].join("\n");

    expect(imagePins({ services, dockerfile })).toEqual([
      {
        source: "docker/production/services.yaml, db",
        ...parseImage("postgres:18-alpine"),
      },
      {
        source: "Dockerfile, NODE_IMAGE",
        ...parseImage(`node:22-bookworm-slim@${DIGEST}`),
      },
    ]);
  });
});

describe("stalePins (WS-126)", () => {
  const pins = [
    { source: "a", ...parseImage(`postgres:18-alpine@${DIGEST}`) },
    { source: "b", ...parseImage(`caddy:2-alpine@${DIGEST}`) },
  ];

  it("names each pin whose tag now resolves to another digest, with both", () => {
    const resolved = new Map([
      ["postgres:18-alpine", OTHER],
      ["caddy:2-alpine", DIGEST],
    ]);

    expect(stalePins(pins, resolved)).toEqual([
      { source: "a", image: "postgres:18-alpine", pinned: DIGEST, current: OTHER },
    ]);
  });

  it("finds nothing when every tag resolves to its pin", () => {
    const resolved = new Map([
      ["postgres:18-alpine", DIGEST],
      ["caddy:2-alpine", DIGEST],
    ]);

    expect(stalePins(pins, resolved)).toEqual([]);
  });

  it("refuses a pin it has no resolved digest for", () => {
    expect(() => stalePins(pins, new Map())).toThrow(/postgres:18-alpine/);
  });
});

describe("manifestDigest (WS-126)", () => {
  it("reads the digest of `imagetools inspect --format '{{json .Manifest}}'`", () => {
    const output = JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.index.v1+json",
      digest: DIGEST,
      size: 10_000,
      manifests: [],
    });

    expect(manifestDigest(`${output}\n`)).toBe(DIGEST);
  });

  it("refuses anything else", () => {
    expect(() => manifestDigest("not json")).toThrow();
    expect(() => manifestDigest(JSON.stringify({ digest: "sha256:abc" }))).toThrow();
  });
});

describe("the major version of PostgreSQL (WS-126)", () => {
  it("reads it from a tag and from the guide", () => {
    expect(tagMajor("18-alpine")).toBe(18);
    expect(tagMajor("18.1-alpine3.22")).toBe(18);
    expect(guideDatabaseMajor("- `db`: PostgreSQL 18 (the image …), its data")).toBe(18);
    expect(guideDatabaseMajor("no such line")).toBeNull();
  });
});

describe("the major version of Node.js (WS-127)", () => {
  it("reads it from .nvmrc", () => {
    expect(nvmrcMajor("22\n")).toBe(22);
    expect(nvmrcMajor("v24.11.1")).toBe(24);
    expect(nvmrcMajor("lts/*")).toBeNull();
  });

  it("tells a base image tag of another major version from .nvmrc's", () => {
    expect(tagMajor("22-bookworm-slim")).not.toBe(nvmrcMajor("24\n"));
  });
});

describe("the repository's images (WS-126)", () => {
  const pins = repositoryPins();
  const db = pins.find((pin) => pin.source === "docker/production/services.yaml, db");

  it("pins every image the example install pulls, and the Dockerfile's base, by digest", () => {
    expect(pins.map((pin) => pin.source)).toEqual([
      "docker/production/services.yaml, db",
      "docker/production/services.yaml, proxy",
      "Dockerfile, NODE_IMAGE",
    ]);
    for (const pin of pins) {
      expect(pin.digest ?? "no digest", `${pin.source}: ${pin.reference}`).toMatch(
        /^sha256:[0-9a-f]{64}$/,
      );
    }
  });

  it("runs the same PostgreSQL tag in development and CI, floating on purpose", () => {
    const development = composeServices(read("compose.yaml")).find(
      (service) => service.service === "db",
    );

    expect(development?.image).toBe(`${db?.repository ?? ""}:${db?.tag ?? ""}`);
  });

  it("names in docs/operations.md the major version the production database runs", () => {
    expect(guideDatabaseMajor(read("docs/operations.md"))).toBe(tagMajor(db?.tag ?? ""));
  });

  it("builds on the Node.js major version of .nvmrc (WS-127)", () => {
    const node = pins.find((pin) => pin.source === "Dockerfile, NODE_IMAGE");

    expect(node?.repository).toBe("node");
    expect(tagMajor(node?.tag ?? "")).toBe(nvmrcMajor(read(".nvmrc")));
  });
});
