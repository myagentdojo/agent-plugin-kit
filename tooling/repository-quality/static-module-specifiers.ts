const typescriptTranspiler = new Bun.Transpiler({ loader: "ts" })

const moduleCall = /\b(?:import|require)\s*\(/g
const leadingTrivia = /^(?:(?:\s+)|(?:\/\/[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*/
const blockComment = /\/\*[\s\S]*?\*\//g
const tripleSlashDependency = /^\/\/\/\s*<(?:reference\s+(?:path|types)|amd-dependency\s+path)\s*=\s*(["'])([^"']+)\1[^>]*\/?>\s*$/gm
const typeDeclarationPatterns = [
  /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s*(?:as\s+[$A-Z_a-z][$\w]*)?|[$A-Z_a-z][$\w]*)\s+from\s*(["'])([^"']+)\1/g,
  /\b(?:import|export)\s*\{[^}]*\btype\b[^}]*\}\s*from\s*(["'])([^"']+)\1/g,
]

export class NonliteralModuleSpecifierError extends Error {
  constructor(file: string) {
    super(`${file} contains a nonliteral import() or require() target`)
    this.name = "NonliteralModuleSpecifierError"
  }
}

type LexicalViews = {
  readonly code: string
  readonly commentsRemoved: string
}

type BraceTransition = {
  readonly depth: number
  readonly done: boolean
}

type ScanStep = {
  readonly index: number
  readonly done: boolean
}

const regularExpressionPrefix = /(?:^|[([{=,:;!?&|+\-*%^~<>]\s*|\b(?:await|case|delete|do|else|in|instanceof|new|of|return|throw|typeof|void|yield)\s*)$/
const regularExpressionLiteral = /^\/(?:\\[\s\S]|\[(?:\\[\s\S]|[^\]\\\r\n])*\]|[^/\\[\]\r\n])*\/[A-Za-z]*/
const controlStatementBeforeCondition = /\b(?:if|while|with|for(?:\s+await)?)\s*$/

function isQuote(character: string | undefined): character is "\"" | "'" {
  return character === "\"" || character === "'"
}

function isTemplateExpressionStart(source: string, index: number): boolean {
  return source.slice(index, index + 2) === "${"
}

function closingBraceTransition(depth: number): BraceTransition {
  return depth === 0 ? { depth, done: true } : { depth: depth - 1, done: false }
}

function matchingOpeningParenthesis(source: string, closingIndex: number): number | undefined {
  const parentheses = [...source.slice(0, closingIndex + 1).matchAll(/[()]/g)]
  let depth = 0
  for (const parenthesis of parentheses.reverse()) {
    depth += parenthesis[0] === ")" ? 1 : -1
    if (depth === 0) return parenthesis.index
  }
  return undefined
}

function closesControlStatementCondition(code: string): boolean {
  const prefix = code.trimEnd()
  if (!prefix.endsWith(")")) return false
  const openingIndex = matchingOpeningParenthesis(prefix, prefix.length - 1)
  return openingIndex !== undefined && controlStatementBeforeCondition.test(prefix.slice(0, openingIndex))
}

function canStartRegularExpression(source: string, code: string, index: number): boolean {
  return regularExpressionPrefix.test(source.slice(0, index)) || closesControlStatementCondition(code)
}

function regularExpressionEnd(source: string, code: string, start: number): number | undefined {
  const match = source.slice(start).match(regularExpressionLiteral)
  return canStartRegularExpression(source, code, start) && match !== null
    ? start + match[0].length
    : undefined
}

class LexicalViewBuilder {
  readonly #code: string[]
  readonly #commentsRemoved: string[]

  constructor(readonly source: string) {
    this.#code = Array.from({ length: source.length }, () => " ")
    this.#commentsRemoved = source.split("")
  }

  build(): LexicalViews {
    this.#scanCode(0, false)
    return { code: this.#code.join(""), commentsRemoved: this.#commentsRemoved.join("") }
  }

  #quotedEnd(start: number): number | undefined {
    const quote = this.source[start]
    if (!isQuote(quote)) return undefined
    return this.#scanQuoted(start, quote)
  }

  #scanQuoted(start: number, quote: "\"" | "'"): number {
    let index = start + 1
    while (index < this.source.length) {
      const escapedEnd = this.#escapedEnd(index)
      if (escapedEnd !== undefined) {
        index = escapedEnd
        continue
      }
      if (this.source[index] === quote) return index + 1
      index += 1
    }
    throw new Error("unterminated string literal")
  }

  #escapedEnd(index: number): number | undefined {
    return this.source[index] === "\\" ? index + 2 : undefined
  }

  #maskComment(start: number, end: number): number {
    for (let index = start; index < end; index += 1) {
      if (this.#commentsRemoved[index] !== "\n" && this.#commentsRemoved[index] !== "\r") {
        this.#commentsRemoved[index] = " "
      }
    }
    return end
  }

  #lineCommentEnd(start: number): number | undefined {
    if (this.source[start] !== "/" || this.source[start + 1] !== "/") return undefined
    const newline = this.source.indexOf("\n", start + 2)
    return this.#maskComment(start, newline === -1 ? this.source.length : newline)
  }

  #blockCommentEnd(start: number): number | undefined {
    if (this.source[start] !== "/" || this.source[start + 1] !== "*") return undefined
    const closing = this.source.indexOf("*/", start + 2)
    if (closing === -1) throw new Error("unterminated block comment")
    return this.#maskComment(start, closing + 2)
  }

  #regularExpressionEnd(start: number): number | undefined {
    return regularExpressionEnd(this.source, this.#code.slice(0, start).join(""), start)
  }

  #templateEnd(start: number): number | undefined {
    if (this.source[start] !== "`") return undefined
    return this.#scanTemplate(start)
  }

  #nonCodeEnd(start: number): number | undefined {
    const readers = [
      this.#quotedEnd,
      this.#templateEnd,
      this.#lineCommentEnd,
      this.#blockCommentEnd,
      this.#regularExpressionEnd,
    ]
    for (const reader of readers) {
      const end = reader.call(this, start)
      if (end !== undefined) return end
    }
    return undefined
  }

  #scanTemplate(start: number): number {
    let index = start + 1
    while (index < this.source.length) {
      const step = this.#templateStep(index)
      if (step.done) return step.index
      index = step.index
    }
    throw new Error("unterminated template literal")
  }

  #templateStep(index: number): ScanStep {
    const escapedEnd = this.#escapedEnd(index)
    if (escapedEnd !== undefined) return { index: escapedEnd, done: false }
    if (this.source[index] === "`") return { index: index + 1, done: true }
    if (isTemplateExpressionStart(this.source, index)) {
      return { index: this.#scanCode(index + 2, true), done: false }
    }
    return { index: index + 1, done: false }
  }

  #braceTransition(index: number, depth: number, stopAtClosingBrace: boolean): BraceTransition {
    if (!stopAtClosingBrace) return { depth, done: false }
    if (this.source[index] === "{") return { depth: depth + 1, done: false }
    if (this.source[index] !== "}") return { depth, done: false }
    return closingBraceTransition(depth)
  }

  #scanCode(start: number, stopAtClosingBrace: boolean): number {
    let braceDepth = 0
    let index = start
    while (index < this.source.length) {
      const nonCodeEnd = this.#nonCodeEnd(index)
      if (nonCodeEnd !== undefined) {
        index = nonCodeEnd
        continue
      }
      const transition = this.#braceTransition(index, braceDepth, stopAtClosingBrace)
      if (transition.done) return index + 1
      braceDepth = transition.depth
      this.#code[index] = this.source[index] as string
      index += 1
    }
    return this.#finishedCodeScan(index, stopAtClosingBrace)
  }

  #finishedCodeScan(index: number, stopAtClosingBrace: boolean): number {
    if (stopAtClosingBrace) throw new Error("unterminated template expression")
    return index
  }
}

function lexicalViews(source: string): LexicalViews {
  return new LexicalViewBuilder(source).build()
}

function sourceWithoutShebang(source: string): string {
  return source.startsWith("#!")
    ? source.replace(/^#![^\n]*/, (shebang) => " ".repeat(shebang.length))
    : source
}

function typeOnlySpecifiers(views: LexicalViews): string[] {
  return typeDeclarationPatterns.flatMap((pattern) =>
    [...views.commentsRemoved.matchAll(pattern)]
      .filter((match) => match.index !== undefined && views.code[match.index] !== " ")
      .flatMap((match) => match[2] === undefined ? [] : [match[2]])
  )
}

function literalModuleCallCount(imports: readonly Bun.Import[]): number {
  return imports.filter(({ kind }) => kind === "dynamic-import" || kind === "require-call").length
}

function tripleSlashModuleSpecifiers(source: string): string[] {
  const preamble = source.match(leadingTrivia)?.[0] ?? ""
  const lineComments = preamble.replace(blockComment, (comment) => comment.replace(/[^\n]/g, " "))
  return [...lineComments.matchAll(tripleSlashDependency)].map((match) => match[2] as string)
}

export function staticModuleSpecifiers(file: string, source: string): string[] {
  const scannedSource = sourceWithoutShebang(source)
  const views = lexicalViews(scannedSource)
  const scannedImports = typescriptTranspiler.scanImports(scannedSource)
  const specifiers = new Set([
    ...scannedImports.map(({ path }) => path),
    ...typeOnlySpecifiers(views),
    ...tripleSlashModuleSpecifiers(scannedSource),
  ])
  const moduleCallCount = [...views.code.matchAll(moduleCall)].length
  if (moduleCallCount !== literalModuleCallCount(scannedImports)) {
    throw new NonliteralModuleSpecifierError(file)
  }
  return [...specifiers]
}
