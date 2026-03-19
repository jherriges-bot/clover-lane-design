import React, { useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'clover-lane-design-app-v1'
const DEFAULT_SHEET_NAME = 'Clover Lane Design'

const DEFAULT_CATEGORIES = [
  { id: crypto.randomUUID(), code: '100', name: 'Administration' },
  { id: crypto.randomUUID(), code: '200', name: 'Demolition' },
  { id: crypto.randomUUID(), code: '300', name: 'Rough Carpentry' },
  { id: crypto.randomUUID(), code: '350', name: 'Exterior Work' },
  { id: crypto.randomUUID(), code: '400', name: 'Finish Carpentry' },
  { id: crypto.randomUUID(), code: '450', name: 'Design' },
  { id: crypto.randomUUID(), code: '500', name: 'Misc Labor' },
  { id: crypto.randomUUID(), code: '600', name: 'Clean Up' },
]

function defaultData() {
  return {
    companyName: 'Clover Lane Design',
    employees: [
      { id: crypto.randomUUID(), name: 'Joseph', role: 'Owner', hourlyCost: 0 },
      { id: crypto.randomUUID(), name: 'Michelle', role: 'Owner', hourlyCost: 0 },
    ],
    categories: DEFAULT_CATEGORIES,
    jobs: [
      { id: crypto.randomUUID(), name: 'Campbell Interior Remodel', client: 'Campbell', status: 'Active', estimatedHours: {} },
    ],
    activeShifts: [],
    entries: [],
    sync: {
      provider: 'Google Sheets',
      sheetName: DEFAULT_SHEET_NAME,
      appScriptUrl: '',
      lastSyncedAt: '',
    },
  }
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaultData()
    const parsed = JSON.parse(saved)
    const fallback = defaultData()
    return {
      ...fallback,
      ...parsed,
      employees: parsed.employees?.length ? parsed.employees : fallback.employees,
      categories: parsed.categories?.length ? parsed.categories : fallback.categories,
      jobs: parsed.jobs?.length ? parsed.jobs : fallback.jobs,
      activeShifts: parsed.activeShifts || [],
      entries: parsed.entries || [],
      sync: {
        provider: parsed.sync?.provider || 'Google Sheets',
        sheetName: parsed.sync?.sheetName || DEFAULT_SHEET_NAME,
        appScriptUrl: parsed.sync?.appScriptUrl || '',
        lastSyncedAt: parsed.sync?.lastSyncedAt || '',
      },
    }
  } catch {
    return defaultData()
  }
}

function formatDateTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString([], {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatHours(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

function formatCurrency(value) {
  return new Intl.NumberFormat([], {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(Number(value || 0))
}

function diffHours(start, end) {
  return Math.max((new Date(end).getTime() - new Date(start).getTime()) / 36e5, 0)
}

function startOfWeek(dateLike) {
  const d = new Date(dateLike)
  const day = d.getDay()
  const diff = (day + 6) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - diff)
  return d
}

function weekLabel(dateLike) {
  return startOfWeek(dateLike).toISOString().slice(0, 10)
}

function groupBy(array, keyGetter) {
  return array.reduce((acc, item) => {
    const key = keyGetter(item)
    acc[key] = acc[key] || []
    acc[key].push(item)
    return acc
  }, {})
}

function scriptTemplate(sheetName) {
  return `function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const targetSheetName = payload.sheetName || '${sheetName}';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(targetSheetName) || ss.insertSheet(targetSheetName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'entryId','source','syncStatus','employee','role','job','client','categoryCode','category','start','end','hours','laborCost','notes','weekStart','createdAt'
      ]);
    }

    const entries = Array.isArray(payload.entries) ? payload.entries : [];
    const existingIds = new Set();
    if (sheet.getLastRow() > 1) {
      const idValues = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
      idValues.forEach(([id]) => existingIds.add(String(id)));
    }

    const rows = entries
      .filter((entry) => !existingIds.has(String(entry.id)))
      .map((entry) => [
        entry.id,
        entry.source || '',
        'synced',
        entry.employeeName || '',
        entry.employeeRole || '',
        entry.jobName || '',
        entry.jobClient || '',
        entry.categoryCode || '',
        entry.categoryName || '',
        entry.start || '',
        entry.end || '',
        Number(entry.hours || 0),
        Number(entry.laborCost || 0),
        entry.notes || '',
        entry.weekStart || '',
        new Date(),
      ]);

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, inserted: rows.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(error) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}`
}

function statCards(data, entries) {
  const totalHours = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
  const totalLaborCost = entries.reduce((sum, entry) => sum + Number(entry.laborCost || 0), 0)
  const openJobs = data.jobs.filter((job) => job.status === 'Active').length
  return [
    ['Active Clocks', data.activeShifts.length],
    ['Total Hours', formatHours(totalHours)],
    ['Labor Cost', formatCurrency(totalLaborCost)],
    ['Open Jobs', openJobs],
  ]
}

function buildWeeklyTimecards(entries) {
  const grouped = groupBy(entries, (entry) => `${entry.employeeId}-${weekLabel(entry.start)}`)
  return Object.values(grouped)
    .map((group) => ({
      employeeName: group[0].employeeName,
      weekStart: weekLabel(group[0].start),
      hours: group.reduce((sum, item) => sum + Number(item.hours || 0), 0),
      laborCost: group.reduce((sum, item) => sum + Number(item.laborCost || 0), 0),
    }))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
}

function section(title, subtitle, children) {
  return (
    <section className="card section">
      <div className="section-header">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function App() {
  const [data, setData] = useState(loadData)
  const [tab, setTab] = useState('dashboard')
  const [now, setNow] = useState(Date.now())
  const [syncState, setSyncState] = useState({ status: 'idle', message: '' })

  const [clockEmployeeId, setClockEmployeeId] = useState('')
  const [clockJobId, setClockJobId] = useState('')
  const [clockCategoryId, setClockCategoryId] = useState('')

  const [manualEmployeeId, setManualEmployeeId] = useState('')
  const [manualJobId, setManualJobId] = useState('')
  const [manualCategoryId, setManualCategoryId] = useState('')
  const [manualStart, setManualStart] = useState('')
  const [manualEnd, setManualEnd] = useState('')
  const [manualNotes, setManualNotes] = useState('')

  const [newEmployee, setNewEmployee] = useState({ name: '', role: '', hourlyCost: '' })
  const [newJob, setNewJob] = useState({ name: '', client: '', status: 'Active' })
  const [newCategory, setNewCategory] = useState({ code: '', name: '' })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }, [data])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!clockEmployeeId && data.employees[0]) setClockEmployeeId(data.employees[0].id)
    if (!clockJobId && data.jobs[0]) setClockJobId(data.jobs[0].id)
    if (!clockCategoryId && data.categories[0]) setClockCategoryId(data.categories[0].id)
    if (!manualEmployeeId && data.employees[0]) setManualEmployeeId(data.employees[0].id)
    if (!manualJobId && data.jobs[0]) setManualJobId(data.jobs[0].id)
    if (!manualCategoryId && data.categories[0]) setManualCategoryId(data.categories[0].id)
  }, [data, clockEmployeeId, clockJobId, clockCategoryId, manualEmployeeId, manualJobId, manualCategoryId])

  const employeeMap = useMemo(() => Object.fromEntries(data.employees.map((item) => [item.id, item])), [data.employees])
  const jobMap = useMemo(() => Object.fromEntries(data.jobs.map((item) => [item.id, item])), [data.jobs])
  const categoryMap = useMemo(() => Object.fromEntries(data.categories.map((item) => [item.id, item])), [data.categories])

  const employeeTotals = useMemo(() => data.employees.map((employee) => {
    const entries = data.entries.filter((entry) => entry.employeeId === employee.id)
    return {
      ...employee,
      hours: entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0),
      laborCost: entries.reduce((sum, entry) => sum + Number(entry.laborCost || 0), 0),
    }
  }), [data.employees, data.entries])

  const jobSummaries = useMemo(() => data.jobs.map((job) => {
    const entries = data.entries.filter((entry) => entry.jobId === job.id)
    const actualHours = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
    const laborCost = entries.reduce((sum, entry) => sum + Number(entry.laborCost || 0), 0)
    const estimatedHours = Object.values(job.estimatedHours || {}).reduce((sum, value) => sum + Number(value || 0), 0)
    return { ...job, actualHours, estimatedHours, variance: actualHours - estimatedHours, laborCost }
  }), [data.jobs, data.entries])

  const weeklyTimecards = useMemo(() => buildWeeklyTimecards(data.entries), [data.entries])

  function updateSyncConfig(field, value) {
    setData((current) => ({ ...current, sync: { ...current.sync, [field]: value } }))
  }

  function enrichEntry(entry) {
    const employee = employeeMap[entry.employeeId]
    const job = jobMap[entry.jobId]
    return {
      ...entry,
      employeeRole: employee?.role || '',
      jobClient: job?.client || '',
      weekStart: weekLabel(entry.start),
    }
  }

  async function syncToGoogleSheets() {
    const url = data.sync.appScriptUrl.trim()
    if (!url) {
      setSyncState({ status: 'error', message: 'Paste your Google Apps Script Web App URL first.' })
      return
    }

    const pendingEntries = data.entries.filter((entry) => entry.syncStatus !== 'synced')
    if (pendingEntries.length === 0) {
      setSyncState({ status: 'success', message: 'Everything is already synced.' })
      return
    }

    setSyncState({ status: 'loading', message: `Syncing ${pendingEntries.length} entries...` })

    try {
      const payload = {
        sheetName: data.sync.sheetName || DEFAULT_SHEET_NAME,
        entries: pendingEntries.map(enrichEntry),
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      })

      const result = await response.json()
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || `HTTP ${response.status}`)
      }

      const syncedIds = new Set(payload.entries.map((entry) => entry.id))
      setData((current) => ({
        ...current,
        entries: current.entries.map((entry) => syncedIds.has(entry.id) ? { ...entry, syncStatus: 'synced' } : entry),
        sync: { ...current.sync, lastSyncedAt: new Date().toISOString() },
      }))
      setSyncState({ status: 'success', message: `${result.inserted ?? payload.entries.length} entries synced.` })
    } catch (error) {
      setSyncState({ status: 'error', message: error instanceof Error ? error.message : 'Sync failed.' })
    }
  }

  function startClock() {
    const employee = employeeMap[clockEmployeeId]
    const job = jobMap[clockJobId]
    const category = categoryMap[clockCategoryId]
    if (!employee || !job || !category) return

    const duplicate = data.activeShifts.some((shift) => shift.employeeId === employee.id && shift.jobId === job.id && shift.categoryId === category.id)
    if (duplicate) return

    const shift = {
      id: crypto.randomUUID(),
      employeeId: employee.id,
      employeeName: employee.name,
      jobId: job.id,
      jobName: job.name,
      categoryId: category.id,
      categoryCode: category.code,
      categoryName: category.name,
      start: new Date().toISOString(),
      notes: '',
      syncStatus: 'pending',
    }
    setData((current) => ({ ...current, activeShifts: [shift, ...current.activeShifts] }))
  }

  function stopClock(shiftId) {
    const shift = data.activeShifts.find((item) => item.id === shiftId)
    if (!shift) return
    const end = new Date().toISOString()
    const employee = employeeMap[shift.employeeId]
    const hours = diffHours(shift.start, end)
    const entry = {
      ...shift,
      end,
      hours,
      source: 'Clock',
      laborCost: Number(employee?.hourlyCost || 0) * hours,
      syncStatus: 'pending',
    }

    setData((current) => ({
      ...current,
      activeShifts: current.activeShifts.filter((item) => item.id !== shiftId),
      entries: [entry, ...current.entries],
    }))
  }

  function addManualEntry() {
    const employee = employeeMap[manualEmployeeId]
    const job = jobMap[manualJobId]
    const category = categoryMap[manualCategoryId]
    if (!employee || !job || !category || !manualStart || !manualEnd) return
    const hours = diffHours(manualStart, manualEnd)
    if (hours <= 0) return

    const entry = {
      id: crypto.randomUUID(),
      employeeId: employee.id,
      employeeName: employee.name,
      jobId: job.id,
      jobName: job.name,
      categoryId: category.id,
      categoryCode: category.code,
      categoryName: category.name,
      start: new Date(manualStart).toISOString(),
      end: new Date(manualEnd).toISOString(),
      hours,
      laborCost: Number(employee.hourlyCost || 0) * hours,
      source: 'Manual',
      notes: manualNotes,
      syncStatus: 'pending',
    }

    setData((current) => ({ ...current, entries: [entry, ...current.entries] }))
    setManualStart('')
    setManualEnd('')
    setManualNotes('')
  }

  function addEmployee() {
    if (!newEmployee.name.trim()) return
    const employee = { id: crypto.randomUUID(), name: newEmployee.name.trim(), role: newEmployee.role.trim(), hourlyCost: Number(newEmployee.hourlyCost || 0) }
    setData((current) => ({ ...current, employees: [...current.employees, employee] }))
    setNewEmployee({ name: '', role: '', hourlyCost: '' })
  }

  function addJob() {
    if (!newJob.name.trim()) return
    const job = { id: crypto.randomUUID(), name: newJob.name.trim(), client: newJob.client.trim(), status: newJob.status, estimatedHours: {} }
    setData((current) => ({ ...current, jobs: [...current.jobs, job] }))
    setNewJob({ name: '', client: '', status: 'Active' })
  }

  function addCategory() {
    if (!newCategory.name.trim()) return
    const category = { id: crypto.randomUUID(), code: newCategory.code.trim() || String(100 + data.categories.length * 50), name: newCategory.name.trim() }
    setData((current) => ({ ...current, categories: [...current.categories, category] }))
    setNewCategory({ code: '', name: '' })
  }

  function updateJobEstimate(jobId, categoryId, value) {
    setData((current) => ({
      ...current,
      jobs: current.jobs.map((job) => job.id !== jobId ? job : {
        ...job,
        estimatedHours: { ...job.estimatedHours, [categoryId]: value === '' ? '' : Number(value) },
      }),
    }))
  }

  function deleteItem(type, id) {
    setData((current) => {
      if (type === 'employee') {
        return {
          ...current,
          employees: current.employees.filter((item) => item.id !== id),
          activeShifts: current.activeShifts.filter((item) => item.employeeId !== id),
          entries: current.entries.filter((item) => item.employeeId !== id),
        }
      }
      if (type === 'job') {
        return {
          ...current,
          jobs: current.jobs.filter((item) => item.id !== id),
          activeShifts: current.activeShifts.filter((item) => item.jobId !== id),
          entries: current.entries.filter((item) => item.jobId !== id),
        }
      }
      if (type === 'category') {
        return {
          ...current,
          categories: current.categories.filter((item) => item.id !== id),
          activeShifts: current.activeShifts.filter((item) => item.categoryId !== id),
          entries: current.entries.filter((item) => item.categoryId !== id),
          jobs: current.jobs.map((job) => {
            const next = { ...job.estimatedHours }
            delete next[id]
            return { ...job, estimatedHours: next }
          }),
        }
      }
      return { ...current, entries: current.entries.filter((item) => item.id !== id) }
    })
  }

  function elapsed(start) {
    const minutes = Math.floor(Math.max(now - new Date(start).getTime(), 0) / 60000)
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  }

  const stats = statCards(data, data.entries)

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Clover Lane Design</h1>
          <p>Phone-friendly crew timeclock, job costing, estimate tracking, and Google Sheets sync.</p>
        </div>
      </header>

      <div className="stats-grid">
        {stats.map(([label, value]) => (
          <div className="card stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <nav className="tabbar">
        {['dashboard', 'clock', 'manual', 'reports', 'setup', 'entries'].map((item) => (
          <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>
        ))}
      </nav>

      {tab === 'dashboard' && (
        <div className="grid two-col">
          {section('Live Crew Board', 'See who is currently on the clock.',
            data.activeShifts.length === 0 ? <div className="empty">Nobody is clocked in right now.</div> :
            <div className="stack">{data.activeShifts.map((shift) => (
              <div className="card inset" key={shift.id}>
                <div className="row between top">
                  <div>
                    <h3>{shift.employeeName}</h3>
                    <p>{shift.jobName}</p>
                  </div>
                  <span className="pill">Running</span>
                </div>
                <p>{shift.categoryCode} · {shift.categoryName}</p>
                <p>Started {formatDateTime(shift.start)}</p>
                <p><strong>Elapsed {elapsed(shift.start)}</strong></p>
                <button className="button button-secondary full" onClick={() => stopClock(shift.id)}>Clock Out</button>
              </div>
            ))}</div>
          )}

          {section('Employee Totals', 'Total hours and labor cost by employee.',
            <div className="stack">{employeeTotals.map((employee) => (
              <div className="card inset" key={employee.id}>
                <div className="row between top">
                  <div>
                    <h3>{employee.name}</h3>
                    <p>{employee.role || 'Crew'}</p>
                  </div>
                  <div className="align-right">
                    <strong>{formatHours(employee.hours)} hrs</strong>
                    <p>{formatCurrency(employee.laborCost)}</p>
                  </div>
                </div>
              </div>
            ))}</div>
          )}

          {section('Job Snapshot', 'Estimated versus actual hours by job.',
            <div className="stack">{jobSummaries.map((job) => (
              <div className="card inset" key={job.id}>
                <div className="row between top">
                  <div>
                    <h3>{job.name}</h3>
                    <p>{job.client || 'No client'}</p>
                  </div>
                  <span className="pill muted">{job.status}</span>
                </div>
                <div className="mini-grid">
                  <div><span>Est.</span><strong>{formatHours(job.estimatedHours)}</strong></div>
                  <div><span>Actual</span><strong>{formatHours(job.actualHours)}</strong></div>
                  <div><span>Variance</span><strong>{formatHours(job.variance)}</strong></div>
                </div>
              </div>
            ))}</div>
          )}
        </div>
      )}

      {tab === 'clock' && section('Start a Clock', 'Choose employee, job, and labor category.',
        <div className="form-grid narrow">
          <label><span>Employee</span><select value={clockEmployeeId} onChange={(e) => setClockEmployeeId(e.target.value)}>{data.employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Job</span><select value={clockJobId} onChange={(e) => setClockJobId(e.target.value)}>{data.jobs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Labor Category</span><select value={clockCategoryId} onChange={(e) => setClockCategoryId(e.target.value)}>{data.categories.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <button className="button full" onClick={startClock}>Clock In</button>
        </div>
      )}

      {tab === 'manual' && section('Manual Time Entry', 'Add missed hours or office work after the fact.',
        <div className="form-grid narrow">
          <label><span>Employee</span><select value={manualEmployeeId} onChange={(e) => setManualEmployeeId(e.target.value)}>{data.employees.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Job</span><select value={manualJobId} onChange={(e) => setManualJobId(e.target.value)}>{data.jobs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Labor Category</span><select value={manualCategoryId} onChange={(e) => setManualCategoryId(e.target.value)}>{data.categories.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label><span>Start</span><input type="datetime-local" value={manualStart} onChange={(e) => setManualStart(e.target.value)} /></label>
          <label><span>End</span><input type="datetime-local" value={manualEnd} onChange={(e) => setManualEnd(e.target.value)} /></label>
          <label><span>Notes</span><input value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} placeholder="Optional note" /></label>
          <button className="button full" onClick={addManualEntry}>Add Hours</button>
        </div>
      )}

      {tab === 'reports' && (
        <div className="grid two-col">
          {section('Job Cost by Category', 'Estimated and actual labor hours for each job category.',
            <div className="stack">{data.jobs.map((job) => {
              const entries = data.entries.filter((entry) => entry.jobId === job.id)
              return (
                <div className="card inset" key={job.id}>
                  <h3>{job.name}</h3>
                  <div className="table-like">
                    <div className="row table-head"><strong>Category</strong><strong>Est.</strong><strong>Actual</strong><strong>Var.</strong></div>
                    {data.categories.map((category) => {
                      const actual = entries.filter((entry) => entry.categoryId === category.id).reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
                      const estimated = Number(job.estimatedHours?.[category.id] || 0)
                      return <div className="row table-row" key={category.id}><span>{category.code} · {category.name}</span><span>{formatHours(estimated)}</span><span>{formatHours(actual)}</span><span>{formatHours(actual - estimated)}</span></div>
                    })}
                  </div>
                </div>
              )
            })}</div>
          )}

          {section('Weekly Timecards', 'Grouped by employee and week start.',
            weeklyTimecards.length === 0 ? <div className="empty">No timecards yet.</div> :
            <div className="stack">{weeklyTimecards.map((card, index) => (
              <div className="card inset" key={`${card.employeeName}-${card.weekStart}-${index}`}>
                <div className="row between top">
                  <div>
                    <h3>{card.employeeName}</h3>
                    <p>Week of {card.weekStart}</p>
                  </div>
                  <div className="align-right">
                    <strong>{formatHours(card.hours)} hrs</strong>
                    <p>{formatCurrency(card.laborCost)}</p>
                  </div>
                </div>
              </div>
            ))}</div>
          )}
        </div>
      )}

      {tab === 'setup' && (
        <div className="stack">
          {section('Google Sheets Sync', 'Connect this app to a shared Google Sheet named Clover Lane Design.',
            <div className="grid two-col">
              <div className="stack">
                <label><span>Sheet Tab Name</span><input value={data.sync.sheetName} onChange={(e) => updateSyncConfig('sheetName', e.target.value)} /></label>
                <label><span>Google Apps Script Web App URL</span><input value={data.sync.appScriptUrl} onChange={(e) => updateSyncConfig('appScriptUrl', e.target.value)} placeholder="Paste deployed web app URL" /></label>
                <div className="row wrap">
                  <button className="button" onClick={syncToGoogleSheets}>Sync Pending Entries</button>
                  {data.sync.lastSyncedAt ? <span className="pill muted">Last sync {formatDateTime(data.sync.lastSyncedAt)}</span> : null}
                </div>
                {syncState.message ? <div className={`notice ${syncState.status}`}>{syncState.message}</div> : null}
                <div className="helper">
                  <p>1. Open a Google Sheet and name it Clover Lane Design.</p>
                  <p>2. Open Extensions → Apps Script.</p>
                  <p>3. Paste the script shown here and deploy it as a web app.</p>
                  <p>4. Copy the web app URL here, then press Sync Pending Entries.</p>
                </div>
              </div>
              <pre className="code-block">{scriptTemplate(data.sync.sheetName || DEFAULT_SHEET_NAME)}</pre>
            </div>
          )}

          <div className="grid three-col">
            {section('Employees', 'Crew members and hourly cost.',
              <div className="stack">
                <label><span>Name</span><input value={newEmployee.name} onChange={(e) => setNewEmployee((v) => ({ ...v, name: e.target.value }))} /></label>
                <label><span>Role</span><input value={newEmployee.role} onChange={(e) => setNewEmployee((v) => ({ ...v, role: e.target.value }))} /></label>
                <label><span>Hourly cost</span><input type="number" value={newEmployee.hourlyCost} onChange={(e) => setNewEmployee((v) => ({ ...v, hourlyCost: e.target.value }))} /></label>
                <button className="button" onClick={addEmployee}>Add Employee</button>
                {data.employees.map((employee) => <div className="card inset" key={employee.id}><div className="row between top"><div><h3>{employee.name}</h3><p>{employee.role || 'Crew'} · {formatCurrency(employee.hourlyCost)}/hr</p></div><button className="icon-button" onClick={() => deleteItem('employee', employee.id)}>×</button></div></div>)}
              </div>
            )}

            {section('Jobs', 'Projects and estimate setup.',
              <div className="stack">
                <label><span>Job name</span><input value={newJob.name} onChange={(e) => setNewJob((v) => ({ ...v, name: e.target.value }))} /></label>
                <label><span>Client</span><input value={newJob.client} onChange={(e) => setNewJob((v) => ({ ...v, client: e.target.value }))} /></label>
                <label><span>Status</span><select value={newJob.status} onChange={(e) => setNewJob((v) => ({ ...v, status: e.target.value }))}><option>Active</option><option>Bidding</option><option>Completed</option></select></label>
                <button className="button" onClick={addJob}>Add Job</button>
                {data.jobs.map((job) => <div className="card inset" key={job.id}><div className="row between top"><div><h3>{job.name}</h3><p>{job.client || 'No client'} · {job.status}</p></div><button className="icon-button" onClick={() => deleteItem('job', job.id)}>×</button></div><div className="estimate-list">{data.categories.map((category) => <label key={category.id}><span>{category.code} · {category.name}</span><input type="number" value={job.estimatedHours?.[category.id] ?? ''} onChange={(e) => updateJobEstimate(job.id, category.id, e.target.value)} placeholder="0" /></label>)}</div></div>)}
              </div>
            )}

            {section('Labor Categories', 'Codes tied to your cost sheet.',
              <div className="stack">
                <label><span>Code</span><input value={newCategory.code} onChange={(e) => setNewCategory((v) => ({ ...v, code: e.target.value }))} /></label>
                <label><span>Category name</span><input value={newCategory.name} onChange={(e) => setNewCategory((v) => ({ ...v, name: e.target.value }))} /></label>
                <button className="button" onClick={addCategory}>Add Category</button>
                {data.categories.map((category) => <div className="card inset" key={category.id}><div className="row between top"><div><h3>{category.code} · {category.name}</h3></div><button className="icon-button" onClick={() => deleteItem('category', category.id)}>×</button></div></div>)}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'entries' && section('Saved Entries', 'Local storage is enabled and Google Sheets sync is ready through Apps Script.',
        data.entries.length === 0 ? <div className="empty">No entries yet.</div> :
        <div className="grid three-col">{data.entries.map((entry) => (
          <div className="card inset" key={entry.id}>
            <div className="row between top">
              <div>
                <h3>{entry.employeeName}</h3>
                <p>{entry.jobName}</p>
              </div>
              <div className="row wrap end">
                <span className="pill">{entry.source}</span>
                <button className="icon-button" onClick={() => deleteItem('entry', entry.id)}>×</button>
              </div>
            </div>
            <p>{entry.categoryCode} · {entry.categoryName}</p>
            <p>In {formatDateTime(entry.start)}</p>
            <p>Out {formatDateTime(entry.end)}</p>
            <p><strong>{formatHours(entry.hours)} hrs · {formatCurrency(entry.laborCost)}</strong></p>
            <p>Sync: {entry.syncStatus || 'pending'}</p>
            {entry.notes ? <p>{entry.notes}</p> : null}
          </div>
        ))}</div>
      )}
    </div>
  )
}
