import { buildDailySeries } from '@/features/creator/lib/analytics'

describe('buildDailySeries', () => {
  it('devuelve siempre 30 días', () => {
    const result = buildDailySeries([])
    expect(result).toHaveLength(30)
  })

  it('rellena días sin datos con calls = 0', () => {
    const result = buildDailySeries([])
    result.forEach(day => expect(day.calls).toBe(0))
  })

  it('suma correctamente las llamadas de un día', () => {
    const today = new Date().toISOString().split('T')[0]
    const raw = [
      { called_at: `${today}T10:00:00Z` },
      { called_at: `${today}T15:00:00Z` },
    ]
    const result = buildDailySeries(raw as { called_at: string }[])
    const todayEntry = result.find(d => d.date === today)
    expect(todayEntry?.calls).toBe(2)
  })

  it('ordena la serie ASC por fecha', () => {
    const result = buildDailySeries([])
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date >= result[i - 1].date).toBe(true)
    }
  })

  it('ignora rows fuera del rango de 30 días', () => {
    const oldDate = '2000-01-01T00:00:00Z'
    const result = buildDailySeries([{ called_at: oldDate }])
    const total = result.reduce((sum, d) => sum + d.calls, 0)
    expect(total).toBe(0)
  })

  it('maneja null como entrada', () => {
    const result = buildDailySeries(null)
    expect(result).toHaveLength(30)
    result.forEach(day => expect(day.calls).toBe(0))
  })
})
