import { getMenu, getRegions } from '../data'
import {
  priceTicket,
  round2,
  type CartLine,
} from '../pricing/engine'

export interface SettleRegionInput {
  regionId: string
  date: string
  tickets: Array<{
    storeId: string
    memberId: string | null
    lines: CartLine[]
  }>
}

export interface RegionSettlement {
  regionId: string
  date: string
  grossTotal: number
  lineDiscountTotal: number
  orderDiscountTotal: number
  discountTotal: number
  netTotal: number
  perCategory: Record<string, number>
  offerUsage: Record<string, number>
  bonus: number
  storesVisited: string[]
  storesMissed: string[]
}

function sortedRecord(values: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...values.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  ))
}

function calculateBonus(netTotal: number): number {
  const tierOne = Math.min(netTotal, 250)
  const tierTwo = Math.min(Math.max(netTotal - 250, 0), 500)
  const tierThree = Math.max(netTotal - 750, 0)
  return round2(tierOne * 0.03 + tierTwo * 0.06 + tierThree * 0.1)
}

export function settleRegion(input: SettleRegionInput): RegionSettlement {
  const region = getRegions().find((candidate) => candidate.id === input.regionId)
  if (!region) {
    throw new Error(`Unknown region: ${input.regionId}`)
  }

  const regionStoreIds = new Set(region.stores.map((stop) => stop.storeId))
  for (const ticket of input.tickets) {
    if (!regionStoreIds.has(ticket.storeId)) {
      throw new Error(`Store not in region: ${ticket.storeId}`)
    }
  }

  const menuById = new Map(getMenu().map((item) => [item.id, item]))
  const categoryTotals = new Map<string, number>()
  const usageCounts = new Map<string, number>()
  let grossTotal = 0
  let lineDiscountTotal = 0
  let orderDiscountTotal = 0
  let netTotal = 0

  for (const ticket of input.tickets) {
    const priced = priceTicket({
      lines: ticket.lines,
      memberId: ticket.memberId,
      date: input.date,
    })

    priced.lines.forEach((line) => {
      grossTotal += line.gross
      lineDiscountTotal += line.discount

      const category = menuById.get(line.productId)!.category
      categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + line.net)

      if (line.appliedOfferId !== null) {
        usageCounts.set(
          line.appliedOfferId,
          (usageCounts.get(line.appliedOfferId) ?? 0) + 1,
        )
      }
    })

    orderDiscountTotal += priced.orderLevel.discount
    netTotal += priced.total
    if (priced.orderLevel.appliedOfferId !== null) {
      usageCounts.set(
        priced.orderLevel.appliedOfferId,
        (usageCounts.get(priced.orderLevel.appliedOfferId) ?? 0) + 1,
      )
    }
  }

  grossTotal = round2(grossTotal)
  lineDiscountTotal = round2(lineDiscountTotal)
  orderDiscountTotal = round2(orderDiscountTotal)
  netTotal = round2(netTotal)

  const seenStops = new Set<string>()
  const orderedStoreIds = region.stores
    .map((stop) => stop.storeId)
    .filter((storeId) => {
      if (seenStops.has(storeId)) return false
      seenStops.add(storeId)
      return true
    })
  const visitedStoreIds = new Set(input.tickets.map((ticket) => ticket.storeId))

  return {
    regionId: input.regionId,
    date: input.date,
    grossTotal,
    lineDiscountTotal,
    orderDiscountTotal,
    discountTotal: round2(lineDiscountTotal + orderDiscountTotal),
    netTotal,
    perCategory: sortedRecord(new Map(
      [...categoryTotals].map(([category, total]) => [category, round2(total)]),
    )),
    offerUsage: sortedRecord(usageCounts),
    bonus: calculateBonus(netTotal),
    storesVisited: orderedStoreIds.filter((storeId) => visitedStoreIds.has(storeId)),
    storesMissed: orderedStoreIds.filter((storeId) => !visitedStoreIds.has(storeId)),
  }
}