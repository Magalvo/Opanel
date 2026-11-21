import packageJson from "../package.json" with { type: "json" };

/** The package's version: the MCP server's version and its `User-Agent`. */
export const VERSION = packageJson.version;
