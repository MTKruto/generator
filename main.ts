// deno-lint-ignore-file no-explicit-any
import { OptionalKind, PropertySignatureStructure } from "jsr:@ts-morph/ts-morph@24.0.0";
import { parse } from "https://deno.land/x/tl_json@1.1.2/mod.ts";
import { join } from "jsr:@std/path@1.0.8/join";
import { convertType, revampType } from "./utilities.ts";
import mtProtoContent from "./mtproto_content.ts";

import CodeBlockWriter from "https://jsr.io/@david/code-block-writer/13.0.1/mod.ts";

const SKIP_IDS = [0x1CB5C415, 0xBC799737, 0x997275B5];

const apiContent = Deno.readTextFileSync(join(import.meta.dirname!, "telegram_api.tl"));

const layer = Number(apiContent.match(/\/\/ LAYER ([0-9]+)/)?.[1]);

const { constructors: mtProtoConstructors, functions: mtProtoFunctions } = parse(mtProtoContent);
const {
  constructors: apiConstructors,
  functions: apiFunctions,
} = parse(apiContent);

const constructors = mtProtoConstructors.concat(apiConstructors);
const functions = mtProtoFunctions.concat(apiFunctions);

const writer = new CodeBlockWriter({ indentNumberOfSpaces: 2 });

writer.writeLine("declare const R: unique symbol;").blankLine();

writer.writeLine("export type Function = { [R]?: unknown };")
  .blankLine();

writer.writeLine("export type ReturnType<T> = T extends Function ? NonNullable<T[typeof R]> : never;").blankLine();

function getInterfaceProperties(params: any[], prefix?: string) {
  const properties = new Array<OptionalKind<PropertySignatureStructure>>();

  for (const param of params) {
    if (param.name.startsWith("flags") && param.type == "#") {
      continue;
    }

    const isFlag = param.type.startsWith("flags");
    const name = param.name;
    const type = convertType(param.type, prefix);

    properties.push({
      name,
      hasQuestionToken: isFlag,
      type,
    });
  }

  return properties;
}

const parentToChildrenRec: Record<string, string[]> = {};

for (const constructor of constructors) {
  if (SKIP_IDS.includes(constructor.id)) {
    continue;
  }

  const type = revampType(constructor.predicate);

  const w = new CodeBlockWriter({ indentNumberOfSpaces: 2 }).write(`export interface ${type}`);
  w.block(() => {
    w.writeLine(`_: "${constructor.predicate}";`);
    for (const p of getInterfaceProperties(constructor.params)) {
      w.writeLine(`${p.name}${p.hasQuestionToken ? "?" : ""}: ${p.type};`);
    }
  });

  parentToChildrenRec[constructor.type] ??= [];
  parentToChildrenRec[constructor.type].push(constructor.predicate);

  const interface_ = w.toString();

  writer.writeLine(interface_);
  writer.blankLine();
}

const genericFunctions = new Array<string>();
for (const function_ of functions) {
  if (SKIP_IDS.includes(function_.id)) {
    continue;
  }

  const isGeneric = function_.params.some((v: any) => v.type == "!X");
  const type = revampType(function_.func);

  const w = new CodeBlockWriter().write(`export interface ${type}${isGeneric ? "<T>" : ""}`);
  if (isGeneric) genericFunctions.push(type);
  w.block(() => {
    w.writeLine(`_: "${function_.func}"`);
    for (const p of getInterfaceProperties(function_.params)) {
      w.writeLine(`${p.name}${p.hasQuestionToken ? "?" : ""}: ${p.type};`);
    }
    w.writeLine(`[R]?: ${convertType(function_.type)};`);
  });

  const interface_ = w.toString();

  writer.writeLine(interface_);
  writer.blankLine();
}

writer.write("export interface Types").block(() => {
  for (const constructor of constructors) {
    if (SKIP_IDS.includes(constructor.id)) {
      continue;
    }
    writer.writeLine(`"${constructor.predicate}": ${revampType(constructor.predicate)};`);
  }
}).blankLine();

writer.write("export interface Functions<T = Function>").block(() => {
  for (const function_ of functions) {
    if (SKIP_IDS.includes(function_.id)) {
      continue;
    }
    const isGeneric = function_.params.some((v: any) => v.type == "!X");
    writer.writeLine(`"${function_.func}": ${revampType(function_.func)}${isGeneric ? "<T>" : ""};`);
  }
}).blankLine();

writer.write("export interface Enums").block(() => {
  for (const [parent] of Object.entries(parentToChildrenRec)) {
    writer.writeLine(`"${parent}": ${revampType(parent)};`);
  }
}).blankLine();

writer.writeLine("export type AnyType = Types[keyof Types];").blankLine();

writer.writeLine("export type AnyFunction<T = Function> = Functions<T>[keyof Functions<T>];").blankLine();

writer.writeLine(`export type AnyGenericFunction<T> = ${genericFunctions.map((v) => `${v}<T>`).join(" | ")}`).blankLine();

writer.writeLine("export type AnyObject<T = Function> = AnyType | AnyFunction<T>;").blankLine();

for (const [parent, children] of Object.entries(parentToChildrenRec)) {
  const alias = `export type ${revampType(parent)} = ${children.map(revampType).join(" | ")};`;

  writer.writeLine(alias);
  writer.blankLine();
}

const id = (v: any) => `0x${v.id.toString(16).toUpperCase().padStart("7B197DC8".length, "0")}`;
writer.write("const map: Map<number, string> = new Map([").indent(() => {
  for (const constructor of constructors) {
    if (SKIP_IDS.includes(constructor.id)) continue;
    writer.writeLine(`[${id(constructor)}, "${constructor.predicate}"],`);
  }
})
  .writeLine("]);")
  .blankLine();

writer.writeLine("export const getTypeName: (id: number) => string | undefined = map.get.bind(map);").blankLine();

function getParamInfo(params: any[], prefix = "") {
  const writer = new CodeBlockWriter({ indentNumberOfSpaces: 2 });

  writer.write("[");

  if (params.length > 0) {
    writer.newLine();
  }

  writer.indent(() => {
    for (const param of params) {
      writer
        .write(
          `["${param.name}", "${param.type}"],`,
        )
        .newLine();
    }
  });
  writer.write("],");

  return writer;
}

writer.writeLine("export type Parameters = [number, [string, string][]];")
  .blankLine();

writer.write("const enums: Map<string, (keyof Types)[]> = new Map([").indent(() => {
  for (const [parent, children] of Object.entries(parentToChildrenRec)) {
    writer.writeLine(`["${parent}", [${children.map((v) => `"${v}"`).join(", ")}]],`);
  }
})
  .writeLine("]);")
  .blankLine();

writer.write("const types: Map<string, Parameters> = new Map([").indent(() => {
  for (const constructor of constructors) {
    if (SKIP_IDS.includes(constructor.id)) continue;
    writer.write("[").indent(() => {
      writer.writeLine(`"${constructor.predicate}",`);
      writer.write("[").indent(() => {
        writer.writeLine(`${id(constructor)},`);
        writer.write(getParamInfo(constructor.params).toString());
      })
        .writeLine("],");
    }).writeLine("],");
  }
  for (const function_ of functions) {
    if (SKIP_IDS.includes(function_.id)) continue;
    writer.write("[").indent(() => {
      writer.writeLine(`"${function_.func}",`);
      writer.write("[").indent(() => {
        writer.writeLine(`${id(function_)},`);
        writer.write(getParamInfo(function_.params).toString());
      })
        .writeLine("],");
    }).writeLine("],");
  }
})
  .writeLine("] as unknown as [string, Parameters][]);")
  .blankLine();

writer.write("const returnTypes = new Map<string, string>([").indent(() => {
  for (const function_ of functions) {
    if (SKIP_IDS.includes(function_.id)) continue;
    writer.writeLine(`["${function_.func}", "${function_.type}"],`);
  }
})
  .write("] as unknown as [string, string][]);")
  .blankLine();

writer.write("export const getType: (name: string) => Parameters | undefined = types.get.bind(types);")
  .blankLine();

writer.write("export const getEnum: (name: string) => (keyof Types)[] | undefined = enums.get.bind(enums);")
  .blankLine();

writer.write("export const getReturnType: (name: string) => string | undefined = returnTypes.get.bind(types);")
  .blankLine();

writer.writeLine("// @ts-ignore: lib");
writer.writeLine('export const _types: Map<string, Parameters> | undefined = typeof Deno === "undefined" ? typeof process === "undefined" ? undefined : process.env.__TYPE_MAP ? types : undefined : Deno.env.get("__TYPE_MAP") ? types : undefined;')
  .blankLine();

Deno.writeTextFileSync("./tl/0_api.ts", writer.toString().trim() + "\n");

Deno.writeTextFileSync("4_constants.ts", Deno.readTextFileSync("4_constants.ts").replace(/LAYER = [0-9]+/i, `LAYER = ${layer}`));
