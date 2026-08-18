import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const sourceRoot = join(projectRoot, 'src')
const fontToolRoot = join(projectRoot, 'deploy', '.rendered', 'font-tools')
const sourceFontRoot = join(projectRoot, 'deploy', '.rendered', 'fonts')
const outputRoot = join(sourceRoot, 'static', 'fonts')
const python = process.env.ACM_PYTHON || 'python'
const allowedExtensions = new Set(['.vue', '.ts', '.js', '.scss', '.css', '.json'])
const excludedDirectories = new Set(['static', 'uni_modules'])

const sourceFiles = []
const collectFiles = (directory) => {
  for (const name of readdirSync(directory)) {
    const absolutePath = join(directory, name)
    const stat = statSync(absolutePath)
    if (stat.isDirectory()) {
      if (!excludedDirectories.has(name)) collectFiles(absolutePath)
      continue
    }
    const dotIndex = name.lastIndexOf('.')
    if (dotIndex >= 0 && allowedExtensions.has(name.slice(dotIndex))) sourceFiles.push(absolutePath)
  }
}

collectFiles(sourceRoot)
sourceFiles.push(join(projectRoot, 'src', 'pages.json'))

const baseCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ！？，。；：、“”‘’（）【】《》—…+-/%¥#@&·~._'
const allText = sourceFiles.map((file) => readFileSync(file, 'utf8')).join('\n') + baseCharacters
const glyphText = Array.from(new Set(Array.from(allText))).join('')
const glyphFile = join(sourceFontRoot, 'ui-glyphs.txt')
mkdirSync(outputRoot, { recursive: true })
writeFileSync(glyphFile, glyphText, 'utf8')

const jobs = [
  {
    input: join(sourceFontRoot, 'NotoSansCJKsc-Regular.otf'),
    output: join(outputRoot, 'ACM-NotoSansSC-Regular.woff2'),
  },
  {
    input: join(sourceFontRoot, 'NotoSerifCJKsc-SemiBold.otf'),
    output: join(outputRoot, 'ACM-NotoSerifSC-SemiBold.woff2'),
  },
]

for (const job of jobs) {
  if (!existsSync(job.input)) throw new Error(`字体源文件不存在：${job.input}`)
  execFileSync(
    python,
    [
      '-m',
      'fontTools.subset',
      job.input,
      `--text-file=${glyphFile}`,
      `--output-file=${job.output}`,
      '--flavor=woff2',
      '--layout-features=*',
      '--glyph-names',
      '--symbol-cmap',
      '--legacy-cmap',
      '--notdef-glyph',
      '--notdef-outline',
      '--recommended-glyphs',
      '--name-IDs=*',
      '--name-legacy',
      '--name-languages=*',
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PYTHONPATH: fontToolRoot,
      },
    },
  )
}

console.log(`已从 ${sourceFiles.length} 个前端文件收集 ${glyphText.length} 个字符。`)
