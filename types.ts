const then = performance.now();
import { parse } from "https://deno.land/x/tl_json@1.1.2/mod.ts";
import { Document, DOMParser, Element } from "jsr:@b-fuze/deno-dom@0.1";
import TurndownService from "npm:turndown";

const turndownService = new TurndownService();

async function load(url: string) {
  const data = await fetch(url).then((v) => v.text());

  const document = new DOMParser().parseFromString(data, "text/html")!;
  for (const a of document.getElementsByTagName("a")) {
    const href = a.getAttribute("href");
    if (href?.startsWith("/")) {
      a.setAttribute("href", new URL(href, "https://core.telegram.org").href);
    }
  }
  return document;
}

function getParameters(
  document: Document,
): Record<string, { type: string; doc: string }> {
  let node = document.getElementById("parameters")?.parentElement?.nextSibling;
  while (node?.nodeType == node?.TEXT_NODE) {
    node = node?.nextSibling;
  }
  const table = (node as Element) ?? null;
  return Object.fromEntries([
    ...(table?.querySelector("tbody")
      ?.getElementsByTagName("tr") ?? []),
  ]
    .map((v) => {
      const cells = [...v.getElementsByTagName("td")];
      return [cells[0].innerText, {
        type: cells[1].innerText,
        doc: turndownService.turndown(cells[2].innerHTML),
      }];
    }));
}

function getDoc(document: Document) {
  return turndownService.turndown(
    document.getElementById("dev_page_content")?.querySelector("p")?.innerHTML,
  ) ?? "";
}

export async function fetchType(
  name: string,
): Promise<{ doc: string; parameters: ReturnType<typeof getParameters> }> {
  const document = await load(`https://core.telegram.org/constructor/${name}`);
  return {
    doc: getDoc(document),
    parameters: getParameters(document),
  };
}

export async function fetchFunction(
  name: string,
): Promise<{ doc: string; parameters: ReturnType<typeof getParameters> }> {
  const document = await load(`https://core.telegram.org/method/${name}`);
  return {
    doc: getDoc(document),
    parameters: getParameters(document),
  };
}

const apiContent = Deno.readTextFileSync("api.tl");

const { constructors, functions: functions_ } = parse(apiContent);

if (!Deno.args.includes("--skip-types")) {
  const types = {} as Record<string, Awaited<ReturnType<typeof fetchType>>>;

  for (const [i, constructor] of constructors.entries()) {
    if (!(constructor.predicate in types)) {
      try {
        types[constructor.predicate] = await fetchType(constructor.predicate);
      } catch (err) {
        console.error(`Failed to fetch type ${constructor.predicate}:`, err);
      }
    }
    console.log(`${i + 1}/${constructors.length}`);
  }
  Deno.writeTextFileSync("types.json", JSON.stringify(types, null, 2));
}

if (!Deno.args.includes("--skip-functions")) {
  const functions = {} as Record<string, Awaited<ReturnType<typeof fetchType>>>;

  for (const [i, func] of functions_.entries()) {
    if (!(func.func in functions)) {
      try {
        functions[func.func] = await fetchFunction(func.func);
      } catch (err) {
        console.error(`Failed to fetch function ${func.func}:`, err);
      }
    }
    console.log(`${i + 1}/${functions_.length}`);
  }
  Deno.writeTextFileSync("functions.json", JSON.stringify(functions, null, 2));
}

console.log("Done in", `${performance.now() - then}ms.`);
