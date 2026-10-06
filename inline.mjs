import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(process.cwd(), 'dist')
const assets = join(dist, 'assets')
const files = readdirSync(assets)
const jsFile = files.find((f) => f.endsWith('.js'))
const cssFile = files.find((f) => f.endsWith('.css'))

const css = readFileSync(join(assets, cssFile), 'utf8')
const js = readFileSync(join(assets, jsFile), 'utf8')

// Body-only content for the Claude Artifact wrapper (no doctype/html/head/body).
const out = `<style>\n${css}\n</style>\n<div id="root"></div>\n<script type="module">\n${js}\n</script>\n`

const target = join(process.cwd(), 'artifact.html')
writeFileSync(target, out, 'utf8')
console.log(`Wrote ${target} (${(out.length / 1024).toFixed(1)} kB)`)

// Full standalone document for internal hosting at prototypes.hub.uniun.io (#13600).
// Same body as the artifact, wrapped so browsers render in standards mode.
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Cash Forecast</title>
</head>
<body>
${out}</body>
</html>
`

const pageTarget = join(process.cwd(), 'prototype.html')
writeFileSync(pageTarget, page, 'utf8')
console.log(`Wrote ${pageTarget} (${(page.length / 1024).toFixed(1)} kB)`)
