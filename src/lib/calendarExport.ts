// Utilitários 100% gratuitos para exportar para Google Agenda (.ics e link direto)

export interface IcsClassItem {
  id: string;
  dayOfWeek: number; // 0=Dom ... 6=Sab
  startTime: string; // "08:00"
  endTime: string; // "09:40"
  subjectName: string;
  professor?: string;
  location?: string;
}

export interface IcsAssessmentItem {
  id: string;
  kind: string; // Prova, Trabalho, Seminário, Dever, Entrega
  title: string;
  subjectName?: string;
  professor?: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  weight?: string;
  notes?: string;
  done?: boolean;
}

export interface IcsStudyBlock {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  minutes: number;
  done?: boolean;
}

const ICS_BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toCompactDate(iso: string): string {
  return iso.replace(/-/g, '');
}

function toCompactDateTime(iso: string, hhmm: string): string {
  const [h, m] = (hhmm || '09:00').split(':');
  return `${toCompactDate(iso)}T${String(h || '09').padStart(2, '0')}${String(m || '00').padStart(2, '0')}00`;
}

function addMinutesToTime(hhmm: string, mins: number): string {
  const [h, m] = (hhmm || '09:00').split(':').map(Number);
  const total = (h || 9) * 60 + (m || 0) + mins;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

function nextDateForDow(dow: number): string {
  const now = new Date();
  const diff = (dow - now.getDay() + 7) % 7;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildGoogleCalendarUrl(params: {
  title: string;
  dateISO: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  location?: string;
  weeklyDow?: number;
}): string {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', params.title);

  if (params.startTime) {
    const start = toCompactDateTime(params.dateISO, params.startTime);
    const end = toCompactDateTime(
      params.dateISO,
      params.endTime || addMinutesToTime(params.startTime, 60)
    );
    url.searchParams.set('dates', `${start}/${end}`);
  } else {
    const start = toCompactDate(params.dateISO);
    const dt = new Date(`${params.dateISO}T12:00:00`);
    dt.setDate(dt.getDate() + 1);
    const nextIso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate()
    ).padStart(2, '0')}`;
    url.searchParams.set('dates', `${start}/${toCompactDate(nextIso)}`);
  }

  if (params.description) url.searchParams.set('details', params.description);
  if (params.location) url.searchParams.set('location', params.location);
  if (typeof params.weeklyDow === 'number') {
    url.searchParams.set('recur', `RRULE:FREQ=WEEKLY;BYDAY=${ICS_BYDAY[params.weeklyDow]}`);
  }

  return url.toString();
}

export function downloadIcsFile(params: {
  filename: string;
  calendarName: string;
  classes: IcsClassItem[];
  assessments: IcsAssessmentItem[];
  blocks: IcsStudyBlock[];
}): number {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StudyFlow//Agenda Escolar e Concursos//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(params.calendarName)}`,
  ];

  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  let count = 0;

  // 1. Aulas semanais recorrentes
  for (const cls of params.classes) {
    const firstDate = nextDateForDow(cls.dayOfWeek);
    const descParts = [
      cls.professor ? `Professor(a): ${cls.professor}` : '',
      cls.location ? `Local/Sala: ${cls.location}` : '',
      'Exportado do StudyFlow',
    ].filter(Boolean);

    lines.push(
      'BEGIN:VEVENT',
      `UID:sf-class-${cls.id}@studyflow`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toCompactDateTime(firstDate, cls.startTime)}`,
      `DTEND:${toCompactDateTime(firstDate, cls.endTime)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${ICS_BYDAY[cls.dayOfWeek]}`,
      `SUMMARY:${escapeIcs(`Aula: ${cls.subjectName}`)}`,
      `DESCRIPTION:${escapeIcs(descParts.join('\n'))}`,
      ...(cls.location ? [`LOCATION:${escapeIcs(cls.location)}`] : []),
      'END:VEVENT'
    );
    count++;
  }

  // 2. Provas, Trabalhos & Entregas
  for (const item of params.assessments) {
    if (item.done) continue;
    const descParts = [
      item.subjectName ? `Matéria: ${item.subjectName}` : '',
      item.professor ? `Professor(a): ${item.professor}` : '',
      item.weight ? `Peso/Valor: ${item.weight}` : '',
      item.notes || '',
    ].filter(Boolean);

    const startLine = item.time
      ? `DTSTART:${toCompactDateTime(item.date, item.time)}`
      : `DTSTART;VALUE=DATE:${toCompactDate(item.date)}`;
    const endLine = item.time
      ? `DTEND:${toCompactDateTime(item.date, addMinutesToTime(item.time, 90))}`
      : `DTEND;VALUE=DATE:${toCompactDate(item.date)}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:sf-assess-${item.id}@studyflow`,
      `DTSTAMP:${stamp}`,
      startLine,
      endLine,
      `SUMMARY:${escapeIcs(`[${item.kind}] ${item.title}`)}`,
      `DESCRIPTION:${escapeIcs(descParts.join('\n'))}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Lembrete StudyFlow',
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT'
    );
    count++;
  }

  // 3. Blocos do cronograma (próximos 30 blocos pendentes)
  for (const b of params.blocks.filter((x) => !x.done).slice(0, 30)) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:sf-block-${b.id}@studyflow`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${toCompactDate(b.date)}`,
      `DTEND;VALUE=DATE:${toCompactDate(b.date)}`,
      `SUMMARY:${escapeIcs(`Estudar: ${b.name} (${b.minutes}min)`)}`,
      'DESCRIPTION:Bloco do Cronograma de Estudos — StudyFlow',
      'END:VEVENT'
    );
    count++;
  }

  lines.push('END:VCALENDAR');

  if (count === 0) return 0;

  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = params.filename.endsWith('.ics') ? params.filename : `${params.filename}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  return count;
}
