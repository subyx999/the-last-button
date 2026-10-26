export interface LetterboxdDiaryEntry {
  title: string
  year: number
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
    } else if (character === '"' && field.length === 0) {
      quoted = true
    } else if (character === '"') {
      throw new Error('The CSV contains a quote outside a quoted field.')
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('The CSV has an unfinished quoted field.')
  row.push(field)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

export function parseLetterboxdDiary(text: string): LetterboxdDiaryEntry[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''))
  const headers = rows[0]?.map((header) => header.trim().toLowerCase()) ?? []
  const titleIndex = headers.indexOf('name')
  const yearIndex = headers.indexOf('year')

  if (titleIndex < 0 || yearIndex < 0) {
    throw new Error('This does not look like a Letterboxd diary CSV. It must include Name and Year columns.')
  }

  const entries = new Map<string, LetterboxdDiaryEntry>()
  for (const row of rows.slice(1)) {
    const title = row[titleIndex]?.trim()
    const yearText = row[yearIndex]?.trim()
    if (!title || !/^\d{4}$/.test(yearText ?? '')) continue

    const entry = { title, year: Number(yearText) }
    const normalizedTitle = entry.title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    entries.set(`${normalizedTitle}|${entry.year}`, entry)
  }

  if (!entries.size) throw new Error('No diary entries with a title and four-digit year were found.')
  if (entries.size > 500) throw new Error('This diary has more than 500 unique entries. Split the CSV and import smaller files.')
  return [...entries.values()]
}
