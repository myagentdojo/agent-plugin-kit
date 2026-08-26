type ModuleCall = {
  readonly end: number
  readonly specifier: string
}

const transpiler = new Bun.Transpiler({ loader: "ts" })

function codeMask(source: string): string {
  const mask = Array.from({ length: source.length }, () => " ")

  function skipQuoted(start: number, quote: "\"" | "'"): number {
    let index = start + 1
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2
        continue
      }
      if (source[index] === quote) return index + 1
      index += 1
    }
    throw new Error("unterminated string literal")
  }

  function skipLineComment(start: number): number {
    const end = source.indexOf("\n", start + 2)
    return end === -1 ? source.length : end
  }

  function skipBlockComment(start: number): number {
    const end = source.indexOf("*/", start + 2)
    if (end === -1) throw new Error("unterminated block comment")
    return end + 2
  }

  function scanTemplate(start: number): number {
    let index = start + 1
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2
        continue
      }
      if (source[index] === "`") return index + 1
      if (source[index] === "$" && source[index + 1] === "{") {
        index = scanCode(index + 2, true)
        continue
      }
      index += 1
    }
    throw new Error("unterminated template literal")
  }

  function scanCode(start: number, stopAtClosingBrace: boolean): number {
    let braceDepth = 0
    let index = start
    while (index < source.length) {
      const character = source[index]
      const next = source[index + 1]
      if (character === "\"" || character === "'") {
        index = skipQuoted(index, character)
        continue
      }
      if (character === "`") {
        index = scanTemplate(index)
        continue
      }
      if (character === "/" && next === "/") {
        index = skipLineComment(index)
        continue
      }
      if (character === "/" && next === "*") {
        index = skipBlockComment(index)
        continue
      }
      if (stopAtClosingBrace && character === "{") braceDepth += 1
      if (stopAtClosingBrace && character === "}") {
        if (braceDepth === 0) return index + 1
        braceDepth -= 1
      }
      mask[index] = character ?? " "
      index += 1
    }
    if (stopAtClosingBrace) throw new Error("unterminated template expression")
    return index
  }

  scanCode(0, false)
  return mask.join("")
}

function skipWhitespace(source: string, start: number): number {
  let index = start
  while (/\s/.test(source[index] ?? "")) index += 1
  return index
}

function readModuleCall(file: string, source: string, start: number, kind: "import" | "require"): ModuleCall {
  const argumentStart = skipWhitespace(source, start)
  const quote = source[argumentStart]
  if (quote !== "\"" && quote !== "'") {
    throw new Error(`${file} contains ${kind}() with a nonliteral target`)
  }
  let index = argumentStart + 1
  let specifier = ""
  while (index < source.length) {
    const character = source[index]
    if (character === "\\") {
      const escaped = source[index + 1]
      if (escaped === undefined) throw new Error(`${file} contains an unterminated ${kind}() target`)
      specifier += escaped
      index += 2
      continue
    }
    if (character === quote) break
    specifier += character
    index += 1
  }
  if (source[index] !== quote) throw new Error(`${file} contains an unterminated ${kind}() target`)
  const afterLiteral = skipWhitespace(source, index + 1)
  if (kind === "require" && source[afterLiteral] !== ")") {
    throw new Error(`${file} contains require() without exactly one literal target`)
  }
  if (kind === "import" && source[afterLiteral] !== ")" && source[afterLiteral] !== ",") {
    throw new Error(`${file} contains import() without a literal first target`)
  }
  return { end: afterLiteral + 1, specifier }
}

export function staticModuleSpecifiers(file: string, source: string): string[] {
  const scanSource = source.startsWith("#!")
    ? source.replace(/^#![^\n]*/, (shebang) => " ".repeat(shebang.length))
    : source
  const specifiers = new Set(transpiler.scanImports(scanSource).map(({ path }) => path))
  const typeDeclarationPattern =
    /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s+as\s+[$A-Z_a-z][$\w]*|[$A-Z_a-z][$\w]*)\s+from\s*(["'])([^"']+)\1/g
  for (const match of scanSource.matchAll(typeDeclarationPattern)) {
    const specifier = match[2]
    if (specifier !== undefined) specifiers.add(specifier)
  }
  const mask = codeMask(scanSource)
  const callPattern = /\b(import|require)\s*\(/g
  for (const match of mask.matchAll(callPattern)) {
    const kind = match[1]
    if (kind !== "import" && kind !== "require") continue
    const openParenthesis = (match.index ?? 0) + match[0].lastIndexOf("(")
    const call = readModuleCall(file, source, openParenthesis + 1, kind)
    specifiers.add(call.specifier)
  }
  return [...specifiers]
}
