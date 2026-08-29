const typescriptTranspiler = new Bun.Transpiler({ loader: "ts" })

const commentStringOrTemplate = /(["'])(?:\\.|(?!\1)[^\\\r\n])*\1|`(?:\\.|[^`])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g
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

function withoutNonCode(source: string): string {
  return source.replace(commentStringOrTemplate, (match) => " ".repeat(match.length))
}

function sourceWithoutShebang(source: string): string {
  return source.startsWith("#!")
    ? source.replace(/^#![^\n]*/, (shebang) => " ".repeat(shebang.length))
    : source
}

function typeOnlySpecifiers(source: string): string[] {
  const code = withoutNonCode(source)
  return typeDeclarationPatterns.flatMap((pattern) =>
    [...source.matchAll(pattern)]
      .filter((match) => match.index !== undefined && code[match.index] !== " ")
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
  const scannedImports = typescriptTranspiler.scanImports(scannedSource)
  const specifiers = new Set([
    ...scannedImports.map(({ path }) => path),
    ...typeOnlySpecifiers(scannedSource),
    ...tripleSlashModuleSpecifiers(scannedSource),
  ])
  const moduleCallCount = [...withoutNonCode(scannedSource).matchAll(moduleCall)].length
  if (moduleCallCount !== literalModuleCallCount(scannedImports)) {
    throw new NonliteralModuleSpecifierError(file)
  }
  return [...specifiers]
}
