import { getStores, getTickets } from '../data'
import { round2 } from '../pricing/engine'

export interface StoreAudit {
  storeId: string
  weightedScore: number | null
  trend: 'up' | 'down' | 'flat' | null
  daysSinceLastTicket: number | null
  dormant: boolean
  status: 'thriving' | 'attention' | 'critical' | 'inactive'
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_IN_MS = 24 * 60 * 60 * 1000

function dateToUtc(date: string): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export function auditStores(asOf: string): StoreAudit[] {
  if (!DATE_PATTERN.test(asOf)) {
    throw new Error(`Invalid date: ${asOf}`)
  }

  const ticketsByStore = new Map<string, ReturnType<typeof getTickets>>()
  for (const ticket of getTickets()) {
    if (ticket.date > asOf) continue
    const storeTickets = ticketsByStore.get(ticket.storeId) ?? []
    storeTickets.push(ticket)
    ticketsByStore.set(ticket.storeId, storeTickets)
  }

  return getStores()
    .map<StoreAudit>((store) => {
      const counted = (ticketsByStore.get(store.id) ?? []).sort((left, right) =>
        right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
      )

      if (counted.length === 0) {
        return {
          storeId: store.id,
          weightedScore: null,
          trend: null,
          daysSinceLastTicket: null,
          dormant: true,
          status: 'inactive',
        }
      }

      const recent = counted.slice(0, 4)
      const weights = [4, 3, 2, 1]
      const weightedTotal = recent.reduce(
        (sum, ticket, index) => sum + ticket.csat * weights[index],
        0,
      )
      const divisor = weights.slice(0, recent.length).reduce((sum, weight) => sum + weight, 0)
      const weightedScore = round2(weightedTotal / divisor)

      let trend: StoreAudit['trend'] = null
      if (counted.length >= 2) {
        const previous = counted.slice(1, 4)
        const previousMean = round2(
          previous.reduce((sum, ticket) => sum + ticket.csat, 0) / previous.length,
        )
        trend = counted[0].csat > previousMean
          ? 'up'
          : counted[0].csat < previousMean ? 'down' : 'flat'
      }

      const daysSinceLastTicket = Math.floor(
        (dateToUtc(asOf) - dateToUtc(counted[0].date)) / DAY_IN_MS,
      )
      const status: StoreAudit['status'] = weightedScore < 3
        ? 'critical'
        : weightedScore < 4 ? 'attention' : 'thriving'

      return {
        storeId: store.id,
        weightedScore,
        trend,
        daysSinceLastTicket,
        dormant: daysSinceLastTicket > 21,
        status,
      }
    })
    .sort((left, right) => left.storeId.localeCompare(right.storeId))
}