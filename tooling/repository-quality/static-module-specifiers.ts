const typescriptTranspiler = new Bun.Transpiler({ loader: "ts" })

const commentStringOrTemplate = /(["'])(?:\\.|(?!\1)[^\\\r\n])*\1|`(?:\\.|[^`])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g
const moduleCall = /\b(?:import|require)\s*\(/g
const leadingTrivia = /^(?:(?:\s+)|(?:\/\/[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/))*/
const tripleSlashDependency = /^\/\/\/\s*<(?:reference\s+(?:path|types)|amd-dependency\s+path)\s*=\s*(["'])([^"']+)\1[^>]*\/?>\s*$/gm
const typeDeclarationPatterns = [
  /\b(?:import|export)\s+type\s+(?:\{[^}]*\}|\*\s*(?:as\s+[$A-Z_a-z][$\w]*)?|[$A-Z_a-z][$\w]*)\s+from\s*(["'])([^"']+)\1/g,
  /\b(?:import|export)\s*\{[^}]*\btype\b[^}]*\}\s*from\s*(["'])([^"']+)\1/g,
]

function withoutComments(source: string): string {
  return source.replace(commentStringOrTemplate, (match) =>
    match.startsWith("/") ? " ".repeat(match.length) : match
  )
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
  const specifiers: string[] = []
  for (const pattern of typeDeclarationPatterns) {
    for (const match of withoutComments(source).matchAll(pattern)) {
      const specifier = match[2]
      if (specifier !== undefined) specifiers.push(specifier)
    }
  }
  return specifiers
}

function literalModuleCallCount(imports: readonly Bun.Import[]): number {
  return imports.filter(({ kind }) => kind === "dynamic-import" || kind === "require-call").length
}

function tripleSlashModuleSpecifiers(source: string): string[] {
  const preamble = source.match(leadingTrivia)?.[0] ?? ""
  return [...preamble.matchAll(tripleSlashDependency)].map((match) => match[2] as string)
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
    throw new Error(`${file} contains a nonliteral import() or require() target`)
  }
  return [...specifiers]
}
