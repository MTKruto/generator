// deno-lint-ignore-file no-explicit-any
import { parse } from "https://deno.land/x/tl_json@1.1.2/mod.ts";
import CodeBlockWriter, { Options } from "https://deno.land/x/code_block_writer@12.0.0/mod.ts";
import { revampId, revampType, toCamelCase } from "./utilities.ts";

const OPTIONS: Partial<Options> = { indentNumberOfSpaces: 2 };

const layerContent = await fetch("https://raw.githubusercontent.com/telegramdesktop/tdesktop/dev/Telegram/SourceFiles/mtproto/scheme/layer.tl").then((v) => v.text());

const apiContent = await fetch("https://raw.githubusercontent.com/telegramdesktop/tdesktop/dev/Telegram/SourceFiles/mtproto/scheme/api.tl").then((v) => v.text());

import mtProtoContent from "./mtproto_content.ts";

const layer = layerContent.match(/\/\/ ?LAYER ?(\d+)/i)?.[1];

const { constructors: mtProtoConstructors, functions: mtProtoFunctions } = parse(mtProtoContent);
const { constructors: apiConstructors, functions: apiFunctions } = parse(apiContent);

// for (const constructor of mtProtoConstructors) {
//   for (const param of constructor.params) {
//     if (param.type == "string") {
//       param.type = "bytes";
//     }
//   }
// }

for (const constructor of mtProtoFunctions) {
  for (const param of constructor.params) {
    if (param.type == "string") {
      param.type = "bytes";
    }
  }
}

const constructors = mtProtoConstructors.concat(apiConstructors);
const functions = mtProtoFunctions.concat(apiFunctions);

let writer = new CodeBlockWriter(OPTIONS);

writer.writeLine("// deno-fmt-ignore-file");

writer
  .writeLine('import { id, params, TLObject, Params, TLObjectConstructor, ParamDesc, paramDesc, flags } from "./1_tl_object.ts";')
  .blankLine();

writer.write("export abstract class Type extends TLObject")
  .block(() => {
  })
  .blankLine();

writer
  .writeLine("// Unknown type (generic)")
  .write("export abstract class TypeX extends Type")
  .block(() => {
  })
  .blankLine();

const skipIds = [0x1CB5C415, 0xBC799737, 0x997275B5];

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
function convertType(type: string, prefix = false, abstract = true) {
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
    type = `Type${revampType(type, true)}`;
    if (abstract) {
      type = `_${type}`;
    }
    if (prefix) {
      type = `types.${type}`;
    }
  }
  if (isVector) {
    return `Array<${type}>`;
  } else {
    return type;
  }
}

function getParamDescGetter(params: any[], prefix = false) {
  const writer = new CodeBlockWriter(OPTIONS);

  writer.write("static get [paramDesc](): ParamDesc").block(() => {
    writer.write("return [");

    if (params.length > 0) {
      writer.newLine();
    }

    writer.withIndentationLevel(2, () => {
      for (const param of params) {
        if (param.name.startsWith("flags") && param.type == "#") {
          writer.writeLine(`["${param.name}", flags, "${param.type}"],`);
          continue;
        }
        let type = convertType(param.type, prefix);
        if (param.type.toLowerCase() == "!x") {
          type = "types.TypeX";
        } else if (type.startsWith("Array")) {
          type = type.split("<")[1].split(">")[0];
          if (
            !type.replace("types.", "").startsWith("_Type") &&
            type != "Uint8Array"
          ) {
            type = `"${type}"`;
          }
          type = `[${type}]`;
        } else if (
          !type.replace("types.", "").startsWith("_Type") &&
          type != "Uint8Array"
        ) {
          type = `"${type}"`;
        }
        const name = toCamelCase(param.name);

        writer.writeLine(`["${name}", ${type}, "${param.type}"],`);
      }
    });

    writer.write("];");
  });

  return writer;
}

function getParamsGetter(params: any[], prefix = false) {
  const writer = new CodeBlockWriter(OPTIONS)
    .write("protected get [params](): Params");

  writer.block(() => {
    writer.write("return [");

    if (params.length > 0) {
      writer.newLine();
    }

    writer.withIndentationLevel(2, () => {
      for (const param of params) {
        if (param.name.startsWith("flags") && param.type == "#") {
          writer.writeLine(`["${param.name}", flags, "${param.type}"],`);
          continue;
        }
        const isFlag = param.type.startsWith("flags");
        let type = convertType(param.type, prefix);
        if (param.type.toLowerCase() == "!x") {
          type = "types.TypeX";
        } else if (type.startsWith("Array")) {
          type = type.split("<")[1].split(">")[0];
          if (
            !type.replace("types.", "").startsWith("_Type") &&
            type != "Uint8Array"
          ) {
            type = `"${type}"`;
          }
          type = `[${type}]`;
        } else if (
          !type.replace("types.", "").startsWith("_Type") &&
          type != "Uint8Array"
        ) {
          type = `"${type}"`;
        }
        const name = toCamelCase(param.name);
        writer
          .write(`[this.${name}${isFlag ? " ?? null" : ""}, ${type}, "${param.type}"],`)
          .newLine();
      }
    });
    writer.write("];");
  });

  return writer;
}

function getPropertiesDeclr(params: any[], prefix = false) {
  let code = "";

  for (const param of params) {
    if (param.name.startsWith("flags") && param.type == "#") {
      continue;
    }

    const isFlag = param.type.startsWith("flags");
    const name = toCamelCase(param.name);
    const type = convertType(param.type, prefix, false);
    code += `${name}${isFlag ? "?:" : ":"} ${type};\n`;
  }

  return code.trim();
}

function getConstructor(params: any[], prefix = false) {
  let allOptional = false;

  const writer = new CodeBlockWriter(OPTIONS)
    .write("constructor(");

  if (params.length > 0) {
    let toAppend = "";
    let flagCount = 0;
    for (const [i, param] of params.entries()) {
      if (param.name.startsWith("flags") && param.type == "#") {
        flagCount++;
        continue;
      }

      const isFlag = param.type.startsWith("flags");
      if (isFlag) {
        flagCount++;
      }
      const name = toCamelCase(param.name);
      const type = convertType(param.type, prefix, false);
      toAppend += `${name}${isFlag ? "?:" : ":"} ${type}; `;
      if (i == params.length - 1) {
        toAppend = toAppend.slice(0, -2) + " ";
      }
    }
    allOptional = flagCount == params.length;
    if (allOptional) {
      toAppend = "params?: { " + toAppend;
    } else {
      toAppend = "params: { " + toAppend;
    }
    writer
      .write(toAppend)
      .write("}");
  }
  writer.write(")");
  writer.block(() => {
    writer.writeLine("super();");
    for (const param of params) {
      if (param.name.startsWith("flags") && param.type == "#") {
        continue;
      }
      const name = toCamelCase(param.name);
      writer.write(`this.${name} = params${allOptional ? "?" : ""}.${name};`)
        .newLine();
    }
  });
  return writer;
}

const types = new Set<string>();
for (const constructor of constructors) {
  if (skipIds.includes(constructor.id)) {
    continue;
  }

  const className = `_Type${revampType(constructor.type, true)}`;

  if (!types.has(className)) {
    writer
      .write(`export abstract class ${className} extends Type`)
      .block()
      .blankLine();
    types.add(className);
  }
}

const entries = new Array<[string, string]>();
const constructorClassNames = new Set<string>();
const parentToChildrenRec: Record<string, string[]> = {};
for (const constructor of constructors) {
  if (skipIds.includes(constructor.id)) {
    continue;
  }

  const parent = `_Type${revampType(constructor.type, true)}`;
  const id = revampId(constructor.id);
  const className = revampType(constructor.predicate, true);
  entries.push([id, className]);
  constructorClassNames.add(className);

  parentToChildrenRec[parent] ??= [];
  parentToChildrenRec[parent].push(className);

  writer
    .write(`export class ${className} extends ${parent}`)
    .block(() => {
      if (constructor.params.length > 0) {
        writer
          .write(getPropertiesDeclr(constructor.params))
          .blankLine();
      }

      writer
        .write("protected get [id]()")
        .block(() => {
          writer.writeLine(`return ${id};`);
        })
        .blankLine();

      writer
        .write(getParamDescGetter(constructor.params).toString())
        .blankLine();

      writer
        .write(getParamsGetter(constructor.params).toString())
        .blankLine();

      writer.write(getConstructor(constructor.params).toString());
    })
    .blankLine();
}

for (const [parent, children] of Object.entries(parentToChildrenRec)) {
  writer.writeLine(`export type ${parent.slice(1)} = ${children.join(" | ")};`);
}

writer.blankLine();

writer.writeLine("export const map = new Map<number, TLObjectConstructor>([");

for (const [id, className] of entries) {
  writer.writeLine(`  [${id}, ${className}],`);
}

writer.writeLine("// deno-lint-ignore no-explicit-any");
writer.writeLine("] as const as any);");

// Deno.writeTextFileSync("tl/2_types.ts", code);
Deno.writeTextFileSync("tl/2_types.ts", writer.toString());

writer = new CodeBlockWriter(OPTIONS);

writer.writeLine("// deno-fmt-ignore-file");
writer.writeLine('import { id, params, TLObject, Params, paramDesc, ParamDesc, flags } from "./1_tl_object.ts";');

writer
  .writeLine('import * as types from "./2_types.ts";')
  .blankLine();

writer
  .write("export abstract class Function<T> extends TLObject").block(() => {
    writer.writeLine("__R: T = Symbol() as unknown as T; // virtual member");
  })
  .blankLine();

for (const function_ of functions) {
  const isGeneric = function_.params.some((v: any) => v.type == "!X");
  let className = revampType(function_.func, true);
  if (isGeneric) {
    className += "<T extends Function<unknown>>";
  }
  const id = revampId(function_.id);
  let type = function_.type;
  const isVector = type.toLowerCase().startsWith("vector<");
  if (isVector) {
    type = type.split("<")[1].slice(0, -1);
  }
  {
    if (type.toLowerCase() == "bool") {
      type = "boolean";
    } else if (type.toLowerCase() == "int") {
      type = "number";
    } else if (type.toLowerCase() == "long") {
      type = "bigint";
    } else if (type.toLowerCase() == "string") {
      type = "string";
    } else {
      type = revampType(type, true);

      const parent = `Type${type}`;
      const children = parentToChildrenRec[parent];
      if (children?.length != 1) {
        type = parent;
      } else {
        type = children[0];
      }

      type = `types.${type}`;
    }
  }
  if (isVector) {
    type += "[]";
  }
  if (isGeneric) {
    type = 'T["__R"]';
  }

  writer
    .write(`export class ${className} extends Function<${type}>`)
    .block(() => {
      if (function_.params.length > 0) {
        writer
          .writeLine(getPropertiesDeclr(function_.params, true))
          .blankLine();
      }

      writer.write("protected get [id]()")
        .block(() => {
          writer.write(`return ${id};`);
        })
        .blankLine();

      writer
        .write(getParamDescGetter(function_.params, true).toString())
        .blankLine();

      writer
        .write(getParamsGetter(function_.params, true).toString())
        .blankLine();

      writer
        .write(getConstructor(function_.params, true).toString());
    })
    .blankLine();
}

Deno.writeTextFileSync("tl/3_functions.ts", writer.toString());

if (layer) {
  const constantsContent = Deno.readTextFileSync("4_constants.ts");
  Deno.writeTextFileSync("4_constants.ts", constantsContent.replace(/(const LAYER ?= ?)\d+/, `$1${layer}`));
} else {
  console.error("Failed to extract layer from api.tl");
}

new Deno.Command("deno", { args: ["fmt"] }).outputSync();
