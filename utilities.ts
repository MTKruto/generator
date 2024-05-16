export function revampType(type: string) {
  if (type == "true") {
    type += "_";
  }
  type = type.split("?").slice(-1)[0];
  if (type.includes(".")) {
    const ns = type.split(".", 1)[0];
    const t = type.split(".")[1];
    return ns + "_" + t;
  } else {
    return type;
  }
}

const typeMap: Record<string, string> = {
  "int": "number",
  "long": "bigint",
  "bool": "boolean",
  "double": "number",
  "true": "true",
  "string": "string",
  "bytes": "Uint8Array",
  "int128": "bigint",
  "int256": "bigint",
  "!x": "T",
};

export function convertType(
  type: string,
  prefix = "",
) {
  if (type.startsWith("flags")) {
    type = type.split("?").slice(-1)[0];
  }
  let isVector = false;
  // toLowerCase because it is sometimes `vector` in mtproto.tl
  if (type.toLowerCase().startsWith("vector")) {
    isVector = true;
    type = type.split("<")[1].split(">")[0];
  }
  const mapping = typeMap[type.toLowerCase()];
  if (mapping != undefined) {
    type = mapping;
  } else {
    type = revampType(type);
    if (prefix) {
      type = `${prefix}${type.endsWith("_") ? type.slice(0, -1) : type}`;
    }
  }
  if (isVector) {
    return `Array<${type}>`;
  } else {
    return type == "X" ? "ReturnType<T>" : type;
  }
}
