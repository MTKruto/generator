// deno-lint-ignore-file no-explicit-any
import { parse } from "https://deno.land/x/tl_json@1.1.2/mod.ts";
import { revampId, revampType, toCamelCase } from "./utilities.ts";

const apiContent = Deno.readTextFileSync("api.tl");

const layer = apiContent.match(/\/\/ ?LAYER ?(\d+)/i)?.[1];

const mtProtoContent = Deno.readTextFileSync("mtproto.tl");

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

let code = `import { id, params, TLObject, Params, TLObjectConstructor, ParamDesc, paramDesc, flags } from "./1_tl_object.ts";

export abstract class Type extends TLObject {
}

// Uknown type
export abstract class TypeX extends Type {}
`;

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
function convertType(type: string, prefix = false) {
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
  let code = `static get [paramDesc](): ParamDesc {
    return [\n`;
  for (const param of params) {
    if (param.name.startsWith("flags") && param.type == "#") {
      code += `["${param.name}",`;
      code += "flags,";
      code += `"${param.type}"],`;
      continue;
    }
    const name = toCamelCase(param.name);
    code += `["${name}", `;
    let type = convertType(param.type, prefix);
    if (param.type.toLowerCase() == "!x") {
      type = "types.TypeX";
    } else if (type.startsWith("Array")) {
      type = type.split("<")[1].split(">")[0];
      if (
        !type.replace("types.", "").startsWith("Type") &&
        type != "Uint8Array"
      ) {
        type = `"${type}"`;
      }
      type = `[${type}]`;
    } else if (
      !type.replace("types.", "").startsWith("Type") &&
      type != "Uint8Array"
    ) {
      type = `"${type}"`;
    }
    code += `${type}, `;
    code += `"${param.type}"`;
    code += "],";
  }
  code += "]\n";
  code += "}\n";
  return code;
}

function getParamsGetter(params: any[], prefix = false) {
  let code = `protected get [params](): Params {
    return [\n`;
  for (const param of params) {
    if (param.name.startsWith("flags") && param.type == "#") {
      code += `["${param.name}",`;
      code += "flags,";
      code += `"${param.type}"],`;
      continue;
    }
    const isFlag = param.type.startsWith("flags");
    let type = convertType(param.type, prefix);
    if (param.type.toLowerCase() == "!x") {
      type = "types.TypeX";
    } else if (type.startsWith("Array")) {
      type = type.split("<")[1].split(">")[0];
      if (
        !type.replace("types.", "").startsWith("Type") &&
        type != "Uint8Array"
      ) {
        type = `"${type}"`;
      }
      type = `[${type}]`;
    } else if (
      !type.replace("types.", "").startsWith("Type") &&
      type != "Uint8Array"
    ) {
      type = `"${type}"`;
    }
    const name = toCamelCase(param.name);
    code += `[this.${name} ${isFlag ? "?? null" : ""}, ${type}, "${param.type}"],\n`;
  }
  code += "]\n}\n";
  return code;
}

function getPropertiesDeclr(params: any[], prefix = false) {
  let code = ``;

  for (const param of params) {
    if (param.name.startsWith("flags") && param.type == "#") {
      continue;
    }

    const isFlag = param.type.startsWith("flags");
    const name = toCamelCase(param.name);
    const type = convertType(param.type, prefix);
    code += `${name}${isFlag ? "?:" : ":"} ${type}\n`;
  }

  return code.trim();
}

function getConstructor(params: any[], prefix = false) {
  let code = `constructor(`;

  if (params.length > 0) {
    code += `params: {`;
    for (const param of params) {
      if (param.name.startsWith("flags") && param.type == "#") {
        continue;
      }

      const isFlag = param.type.startsWith("flags");
      const name = toCamelCase(param.name);
      const type = convertType(param.type, prefix);
      code += `${name}${isFlag ? "?:" : ":"} ${type}, `;
    }
    code += "}";
  }
  code += ") {\n";
  code += "super()\n";
  for (const param of params) {
    if (param.name.startsWith("flags") && param.type == "#") {
      continue;
    }
    const name = toCamelCase(param.name);
    code += `this.${name} = params.${name};\n`;
  }
  code += "}\n";
  return code;
}

const types = new Set<string>();
for (const constructor of constructors) {
  if (skipIds.includes(constructor.id)) {
    continue;
  }

  const className = `Type${revampType(constructor.type, true)}`;

  if (!types.has(className)) {
    code += `
export abstract class ${className} extends Type {
}
`;
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

  const parent = `Type${revampType(constructor.type, true)}`;
  const id = revampId(constructor.id);
  const className = revampType(constructor.predicate, true);
  entries.push([id, className]);
  constructorClassNames.add(className);

  parentToChildrenRec[parent] ??= [];
  parentToChildrenRec[parent].push(className);

  code += `
export class ${className} extends ${parent} {
  ${getPropertiesDeclr(constructor.params)}
    
  protected get [id]() {
    return ${id}
  }

  ${getParamDescGetter(constructor.params)}

  ${getParamsGetter(constructor.params)}

  ${getConstructor(constructor.params)}
}
`;
}

code += `
export const map = new Map<number, TLObjectConstructor>([
`;

for (const [id, className] of entries) {
  code += `[${id}, ${className}],\n`;
}

code += `// deno-lint-ignore no-explicit-any
] as const as any);
`;

Deno.writeTextFileSync("tl/2_types.ts", code);

code = `import { id, params, TLObject, Params, paramDesc, ParamDesc, flags } from "./1_tl_object.ts";
import * as types from "./2_types.ts";

export abstract class Function<T> extends TLObject {
  __R: T = Symbol() as unknown as T // virtual member
}
`;

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

  code += `
export class ${className} extends Function<${type}> {
  ${getPropertiesDeclr(function_.params, true)}

  protected get [id]() {
    return ${id}
  }

  ${getParamDescGetter(function_.params, true)}

  ${getParamsGetter(function_.params, true)}

  ${getConstructor(function_.params, true)}
}
  `;
}

Deno.writeTextFileSync("tl/3_functions.ts", code);

if (layer) {
  const constantsContent = Deno.readTextFileSync("constants.ts");
  Deno.writeTextFileSync("constants.ts", constantsContent.replace(/(const LAYER ?= ?)\d+/, `$1${layer}`));
} else {
  console.error("Failed to extract layer from api.tl");
}

new Deno.Command("deno", { args: ["fmt"] }).outputSync();
