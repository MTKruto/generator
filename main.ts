// deno-lint-ignore-file no-explicit-any
import { parse } from "https://deno.land/x/tl_json@1.1.2/mod.ts";
import CodeBlockWriter, { Options } from "https://deno.land/x/code_block_writer@12.0.0/mod.ts";
import { revampId, revampType } from "./utilities.ts";

const OPTIONS: Partial<Options> = { indentNumberOfSpaces: 2 };

const apiContent = await fetch(
  "https://raw.githubusercontent.com/telegramdesktop/tdesktop/dev/Telegram/SourceFiles/mtproto/scheme/api.tl",
).then((v) => v.text());

// const apiContent = Deno.readTextFileSync("../generator/api.tl");

import mtProtoContent from "./mtproto_content.ts";

const layer = apiContent.match(/\/\/ ?LAYER ?(\d+)/i)?.[1];

const { constructors: mtProtoConstructors, functions: mtProtoFunctions } = parse(mtProtoContent);
const { constructors: apiConstructors, functions: apiFunctions } = parse(
  apiContent,
);

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
  .writeLine(
    'import { id, params, TLObject, Params, TLObjectConstructor, ParamDesc, paramDesc, flags } from "./1_tl_object.ts";',
  )
  .blankLine();

writer.write("export abstract class Type_ extends TLObject")
  .block(() => {
  })
  .blankLine();

writer
  .writeLine("// Unknown type (generic)")
  .write("export abstract class TypeX_ extends Type_")
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

function convertType(type: string, prefix = "", abstract = true, ns = false, underscore = true) {
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
    type = revampType(type, ns);
    if (abstract) {
      type = `_${type}`;
    }
    if (prefix) {
      type = `${prefix}${type.endsWith("_") ? type.slice(0, -1) : type}`;
    }
  }
  if (!underscore && type.startsWith("_")) {
    type = type.slice(1);
  }
  if (isVector) {
    return `Array<${type}>`;
  } else {
    return type;
  }
}

function getParamDescGetter(params: any[], prefix?: string) {
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
        let type = convertType(param.type, prefix, undefined);
        if (param.type.toLowerCase() == "!x") {
          type = 'types["TypeX"]';
        } else if (type.startsWith("Array")) {
          type = type.split("<")[1].split(">")[0];
          if (
            (!type.replace("types.", "").startsWith("_")) &&
            type != "Uint8Array"
          ) {
            type = `"${type}"`;
          }
          type = `[${type}]`;
        } else if (
          (!type.replace("types.", "").startsWith("_")) &&
          type != "Uint8Array"
        ) {
          type = `"${type}"`;
        }
        const name = param.name;

        writer.writeLine(`["${name}", ${type}, "${param.type}"],`);
      }
    });

    writer.write("];");
  });

  return writer;
}

function getParamsGetter(params: any[], prefix = "", underscore?: boolean) {
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
        let type = convertType(param.type, prefix, undefined, undefined, underscore);
        if (param.type.toLowerCase() == "!x") {
          type = "types.TypeX";
        } else if (type.startsWith("Array")) {
          type = type.split("<")[1].split(">")[0];
          if (
            (!type.replace(prefix, "").startsWith("_")) &&
            type != "Uint8Array"
          ) {
            type = `"${type}"`;
          }
          type = `[${type}]`;
        } else if (
          (!type.replace(prefix, "").startsWith("_")) &&
          type != "Uint8Array"
        ) {
          type = `"${type}"`;
        }
        const name = param.name;
        writer
          .write(
            `[this.${name}${isFlag ? " ?? null" : ""}, ${type}, "${param.type}"],`,
          )
          .newLine();
      }
    });
    writer.write("];");
  });

  return writer;
}

function getPropertiesDeclr(params: any[], prefix?: string) {
  let code = "";

  for (const param of params) {
    if (param.name.startsWith("flags") && param.type == "#") {
      continue;
    }

    const isFlag = param.type.startsWith("flags");
    const name = param.name;
    const type = convertType(param.type, prefix, false, true);
    code += `${name}${isFlag ? "?:" : ":"} ${type};\n`;
  }

  return code.trim();
}

function getConstructorParams(params: any[], prefix?: string) {
  let allOptional = false;

  const writer = new CodeBlockWriter(OPTIONS);

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
      const name = param.name;
      const type = convertType(param.type, prefix, false, true);
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
  return [writer.toString(), allOptional];
}

function getConstructor(params: any[], prefix?: string) {
  const writer = new CodeBlockWriter(OPTIONS)
    .write("constructor(");

  const [params_, allOptional] = getConstructorParams(params, prefix);
  writer.write(params_.toString());

  writer.write(")");
  writer.block(() => {
    writer.writeLine("super();");
    for (const param of params) {
      if (param.name.startsWith("flags") && param.type == "#") {
        continue;
      }
      const name = param.name;
      writer.write(`this.${name} = params${allOptional ? "?" : ""}.${name};`)
        .newLine();
    }
  });
  return writer;
}

const types = new Set<string>();
const constructorNamespaces = new Set<string>();
for (const constructor of constructors) {
  const name = constructor.predicate;
  if (name.includes(".")) {
    const ns = name.split(".", 1)[0];
    constructorNamespaces.add(ns);
  }
}

const functionNamespaces = new Set<string>();
for (const func of functions) {
  const name = func.func;
  if (name.includes(".")) {
    const ns = name.split(".", 1)[0];
    functionNamespaces.add(ns);
  }
}

for (const constructor of constructors) {
  if (skipIds.includes(constructor.id)) {
    continue;
  }

  const className = `_${revampType(constructor.type)}`;

  if (!types.has(className)) {
    writer
      .write(`export abstract class ${className} extends Type_`)
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

  const parent = `_${revampType(constructor.type)}`;
  const id = revampId(constructor.id);
  const className = revampType(constructor.predicate);
  entries.push([id, className]);
  constructorClassNames.add(className);

  parentToChildrenRec[parent] ??= [];
  parentToChildrenRec[parent].push(className);

  writer
    .write(`export class ${className} extends ${parent}`)
    .block(() => {
      if (constructor.params.length > 0) {
        writer
          .write(getPropertiesDeclr(constructor.params, "enums."))
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

      writer.write(getConstructor(constructor.params, "enums.").toString());
    })
    .blankLine();
}

writer.writeLine("export const types = {");

writer.indent(() => {
  writer.writeLine("Type: Type_,");
  writer.writeLine("TypeX: TypeX_,");
  for (const type of types) {
    writer.writeLine(`${type.slice(0, -1)}: ${type},`);
  }
  for (const constructor of constructors) {
    if (skipIds.includes(constructor.id)) {
      continue;
    }
    if (constructor.predicate.includes(".")) {
      continue;
    }
    writer.writeLine(`${revampType(constructor.predicate).slice(0, -1)}: ${revampType(constructor.predicate)},`);
  }

  for (const ns of constructorNamespaces) {
    writer.writeLine(`${ns}: {`);
    writer.indent(() => {
      for (const constructor of constructors) {
        if (skipIds.includes(constructor.id)) {
          continue;
        }
        if (!constructor.predicate.startsWith(ns + ".")) {
          continue;
        }
        writer.writeLine(`${revampType(constructor.predicate.split(".")[1]).slice(0, -1)}: ${revampType(constructor.predicate)},`);
      }
    });
    writer.writeLine("},");
  }
});

writer.writeLine("};");

writer.write("export declare namespace types").block(() => {
  writer.writeLine("type Type = Type_;");
  writer.writeLine("type TypeX = TypeX_;");
  for (const type of types) {
    writer.writeLine(`type ${type.slice(0, -1)} = ${type};`);
  }
  for (const constructor of constructors) {
    if (skipIds.includes(constructor.id)) {
      continue;
    }
    if (constructor.predicate.includes(".")) {
      continue;
    }
    writer.writeLine(`type ${revampType(constructor.predicate).slice(0, -1)} = ${revampType(constructor.predicate)};`);
  }

  for (const ns of constructorNamespaces) {
    writer.writeLine(`namespace ${ns} {`);
    writer.indent(() => {
      for (const constructor of constructors) {
        if (skipIds.includes(constructor.id)) {
          continue;
        }
        if (!constructor.predicate.startsWith(ns + ".")) {
          continue;
        }
        writer.writeLine(`type ${revampType(constructor.predicate.split(".")[1]).slice(0, -1)} = ${revampType(constructor.predicate)};`);
      }
    });
    writer.writeLine("}");
  }
});

writer.writeLine("export const map = new Map<number, TLObjectConstructor>([");

for (const [id, className] of entries) {
  writer.writeLine(`  [${id}, ${className}],`);
}

writer.writeLine("// deno-lint-ignore no-explicit-any");
writer.writeLine("] as const as any);");
function typeRef(s: string) {
  for (const ns of constructorNamespaces) {
    if (s.startsWith(ns + "_")) {
      const ns = s.split("_", 1)[0];
      const t = s.split("_").slice(1).join("_");
      s = ns + "." + t;
    }
  }
  return `types.${s.slice(0, -1)}`;
}
function enumRef(s: string) {
  for (const ns of constructorNamespaces) {
    if (s.startsWith(ns + "_")) {
      const ns = s.split("_", 1)[0];
      const t = s.split("_").slice(1).join("_");
      s = ns + "." + t;
    }
  }
  return `enums.${s.slice(0, -1)}`;
}
writer.write("export declare namespace enums").block(() => {
  for (let [parent, children] of Object.entries(parentToChildrenRec)) {
    if ([...constructorNamespaces].some((v) => parent.startsWith("_" + v))) {
      continue;
    }
    if (parent.endsWith("_")) {
      parent = parent.slice(0, -1);
    }
    writer.writeLine(`type ${parent.slice(1)} = ${children.map(typeRef).join(" | ")};`);
  }

  for (const ns of constructorNamespaces.values()) {
    writer.write("namespace " + ns).block(() => {
      for (let [parent, children] of Object.entries(parentToChildrenRec)) {
        if (!parent.startsWith("_" + ns + "_")) {
          continue;
        }
        parent = parent.split("_")[2];
        if (parent.endsWith("_")) {
          parent = parent.slice(0, -1);
        }
        writer.writeLine(`type ${parent} = ${children.map(typeRef).join(" | ")};`);
      }
    });
  }
});

writer.newLine();

Deno.writeTextFileSync("tl/2_types.ts", writer.toString());

writer = new CodeBlockWriter(OPTIONS);

writer.writeLine("// deno-fmt-ignore-file");
writer.writeLine(
  'import { id, params, TLObject, Params, paramDesc, ParamDesc, flags } from "./1_tl_object.ts";',
);

writer
  .writeLine('import { types, enums } from "./2_types.ts";')
  .blankLine();

writer
  .write("export abstract class Function_<T> extends TLObject").block(() => {
    writer.writeLine("__R: T = Symbol() as unknown as T; // virtual member");
  })
  .blankLine();

for (const function_ of functions) {
  const isGeneric = function_.params.some((v: any) => v.type == "!X");
  let className = revampType(function_.func, undefined, true);
  if (isGeneric) {
    className += "<T extends Function_<unknown>>";
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
      type = revampType(type);

      const parent = `${type}`;
      const children = parentToChildrenRec[parent];
      if (children?.length != 1) {
        type = parent;
      } else {
        type = children[0];
      }

      type = enumRef(type);
    }
  }
  if (isVector) {
    type += "[]";
  }
  if (isGeneric) {
    type = 'T["__R"]';
  }

  writer
    .write(`export class ${className} extends Function_<${type}>`)
    .block(() => {
      writer.writeLine(`static __F = Symbol() as unknown as ${isGeneric ? "<T extends Function_<unknown>>" : ""}(${getConstructorParams(function_.params, "enums.")[0]}) => ${type};`);

      if (function_.params.length > 0) {
        writer
          .writeLine(getPropertiesDeclr(function_.params, "enums."))
          .blankLine();
      }

      writer.write("protected get [id]()")
        .block(() => {
          writer.write(`return ${id};`);
        })
        .blankLine();

      writer
        .write(getParamDescGetter(function_.params, "types.").toString())
        .blankLine();

      writer
        .write(getParamsGetter(function_.params, "types.", false).toString())
        .blankLine();

      writer
        .write(getConstructor(function_.params, "enums.").toString());
    })
    .blankLine();
}

writer.writeLine("export const functions = {");

writer.indent(() => {
  writer.writeLine("Function: Function_,");

  for (const function_ of functions) {
    if (function_.func.includes(".")) {
      continue;
    }
    const className = revampType(function_.func, undefined, true);
    writer.writeLine(`${className.slice(0, -1)}: ${className},`);
  }

  for (const ns of functionNamespaces) {
    writer.writeLine(`${ns}: {`);
    writer.indent(() => {
      for (const function_ of functions) {
        if (!function_.func.startsWith(ns + ".")) {
          continue;
        }
        writer.writeLine(`${revampType(function_.func.split(".")[1], undefined, true).slice(0, -1)}: ${revampType(function_.func, undefined, true)},`);
      }
    });
    writer.writeLine("},");
  }
});

writer.writeLine("};");

writer.write("export declare namespace functions").block(() => {
  writer.writeLine("type Function<T> = Function_<T>;");

  for (const function_ of functions) {
    if (function_.func.includes(".")) {
      continue;
    }
    const className = revampType(function_.func, undefined, true);
    const isGeneric = function_.params.some((v: any) => v.type == "!X");
    writer.writeLine(`type ${className.slice(0, -1)}${isGeneric ? "<T extends Function<unknown>>" : ""} = ${className}${isGeneric ? "<T>" : ""};`);
  }

  for (const ns of functionNamespaces) {
    writer.write(`namespace ${ns}`).block(() => {
      for (const function_ of functions) {
        if (!function_.func.startsWith(ns + ".")) {
          continue;
        }
        const isGeneric = function_.params.some((v: any) => v.type == "!X");
        writer.writeLine(`type ${revampType(function_.func.split(".")[1], undefined, true).slice(0, -1)}${isGeneric ? "<T extends Function<unknown>>" : ""} = ${revampType(function_.func, undefined, true)}${isGeneric ? "<T>" : ""};`);
      }
    });
  }
});

writer.newLine();

Deno.writeTextFileSync("tl/3_functions.ts", writer.toString());

if (layer) {
  const constantsContent = Deno.readTextFileSync("4_constants.ts");
  Deno.writeTextFileSync(
    "4_constants.ts",
    constantsContent.replace(/(const LAYER ?= ?)\d+/, `$1${layer}`),
  );
} else {
  console.error("Failed to extract layer from api.tl");
}

new Deno.Command("deno", { args: ["fmt"] }).outputSync();
