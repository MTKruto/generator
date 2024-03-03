import { bufferFromBigInt } from "https://esm.sh/gh/MTKruto/MTKruto@5f60ae79599f854042820723127c0f60c5069073/utilities/0_buffer.ts";

export function revampType(type: string, nss = false, func = false) {
  type = type.split("?").slice(-1)[0];
  if (type.includes(".")) {
    const ns = type.split(".", 1)[0];
    const t = type.split(".")[1];
    type = ns + (nss ? "." : "_") + (func ? t[0] : t[0].toUpperCase()) +
      t.slice(1);
  } else {
    type = (func ? type[0] : type[0].toUpperCase()) + type.slice(1);
  }
  // return type
  return type + "_";
}

export function revampId(id: number) {
  return "0x" + [...bufferFromBigInt(id, 4, false, true)]
    .map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
