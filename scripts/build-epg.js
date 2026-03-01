const fs = require('fs')
const path = require('path')
const axios = require('axios')
const { XMLParser } = require('fast-xml-parser')
const { DateTime } = require('luxon')

const site = require('../sites/superguidatv.it.js')

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function toXmltvDate(dt) {
  // XMLTV formato: YYYYMMDDhhmmss +0000
  return dt.toUTC().toFormat("yyyyLLddHHmmss ' +0000'").replace('  +0000', ' +0000')
}

function normalizeChannelId(ch) {
  // Preferisci xmltv_id se presente
  if (ch.xmltv_id && ch.xmltv_id.trim()) return ch.xmltv_id.trim()

  // fallback: superguidatv.it + site_id
  return `superguidatv.it:${ch.site_id}`
}

function readChannelsXml(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8')
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: true
  })
  const data = parser.parse(xml)

  const arr = data?.channels?.channel
  if (!arr) return []

  const channels = Array.isArray(arr) ? arr : [arr]
  return channels.map((c) => ({
    site: c.site,
    site_id: c.site_id,
    lang: c.lang || 'it',
    xmltv_id: c.xmltv_id || '',
    name: typeof c === 'string' ? c : (c['#text'] || '').trim()
  }))
}

async function fetchProgramsForChannel(channel, days) {
  const programsAll = []
  let date = DateTime.now().toUTC().startOf('day')

  for (let i = 0; i < days; i++) {
    const dayDate = date.plus({ days: i })
    const url = site.url({ channel, date: dayDate })

    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (xvb-epg bot)'
      },
      timeout: 30000
    })

    const programs = site.parser({ content: res.data, date: dayDate })
    programsAll.push(...programs)
  }

  return programsAll
}

async function main() {
  const channelsFile = path.join(process.cwd(), 'channels', 'superguidatv.channels.xml')
  const channels = readChannelsXml(channelsFile)

  if (!channels.length) {
    throw new Error('Nessun canale trovato in channels/superguidatv.channels.xml')
  }

  // intestazione XMLTV
  let out = ''
  out += `<?xml version="1.0" encoding="UTF-8"?>\n`
  out += `<tv generator-info-name="xvb-epg" source-info-name="superguidatv.it">\n`

  // canali
  for (const ch of channels) {
    const id = normalizeChannelId(ch)
    out += `  <channel id="${escapeXml(id)}">\n`
    out += `    <display-name lang="${escapeXml(ch.lang || 'it')}">${escapeXml(ch.name)}</display-name>\n`
    out += `  </channel>\n`
  }

  // programmi
  for (const ch of channels) {
    const id = normalizeChannelId(ch)

    let programs = []
    try {
      programs = await fetchProgramsForChannel(ch, site.days || 3)
    } catch (e) {
      // se un canale fallisce, continuiamo con gli altri
      // (utile perché alcuni canali possono non avere palinsesto)
      continue
    }

    for (const p of programs) {
      const start = toXmltvDate(p.start)
      const stop = toXmltvDate(p.stop)

      out += `  <programme channel="${escapeXml(id)}" start="${escapeXml(start)}" stop="${escapeXml(stop)}">\n`
      out += `    <title lang="it">${escapeXml(p.title)}</title>\n`
      if (p.category) out += `    <category lang="it">${escapeXml(p.category)}</category>\n`
      out += `  </programme>\n`
    }
  }

  out += `</tv>\n`

  process.stdout.write(out)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
