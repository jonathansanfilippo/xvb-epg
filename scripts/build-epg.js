const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { DateTime } = require('luxon')
const { create } = require('@iptv/xmltv')

const superguidatv = require('../sites/superguidatv.it')

function makeXmltvId(siteId, name) {
  const safe = (siteId || name || 'channel')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `superguidatv.${safe}`
}

async function main() {
  const outDir = path.join(process.cwd(), 'dist')
  const outFile = path.join(outDir, 'guide.xml')
  fs.mkdirSync(outDir, { recursive: true })

  const channels = await superguidatv.channels()

  const base = DateTime.now().setZone('Europe/Rome').startOf('day')
  const dates = [0, 1, 2].map(d => base.plus({ days: d }))

  const xmlChannels = []
  const xmlProgrammes = []

  for (const ch of channels) {
    const xmltv_id = makeXmltvId(ch.site_id, ch.name)

    xmlChannels.push({
      id: xmltv_id,
      displayName: [{ _text: ch.name, lang: 'it' }]
    })

    for (const date of dates) {
      const url = superguidatv.url({ channel: ch, date })
      if (!url) continue

      let html
      try {
        html = (await axios.get(url, { timeout: 30000 })).data
      } catch {
        continue
      }

      const programs = superguidatv.parser({ content: html, date })

      for (const p of programs) {
        const start = p.start.toFormat("yyyyMMddHHmmss ' +0000'")
        const stop = p.stop.toFormat("yyyyMMddHHmmss ' +0000'")

        xmlProgrammes.push({
          channel: xmltv_id,
          start,
          stop,
          title: [{ _text: p.title || '', lang: 'it' }],
          category: p.category
            ? [{ _text: p.category, lang: 'it' }]
            : undefined
        })
      }
    }
  }

  const tv = create({
    generatorInfoName: 'xvb-epg',
    channels: xmlChannels,
    programmes: xmlProgrammes
  })

  fs.writeFileSync(outFile, tv, 'utf8')

  console.log(`EPG generata: ${outFile}`)
  console.log(`Canali: ${xmlChannels.length}`)
  console.log(`Programmi: ${xmlProgrammes.length}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
