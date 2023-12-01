import { bufferFromBigInt } from "https://esm.sh/gh/MTKruto/MTKruto@5f60ae79599f854042820723127c0f60c5069073/utilities/0_buffer.ts";

export function revampType(type: string) {
  type = type.split("?").slice(-1)[0];
  return type.replace(".", "_");
}

export function revampId(id: number) {
  return "0x" + [...bufferFromBigInt(id, 4, false, true)]
    .map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
