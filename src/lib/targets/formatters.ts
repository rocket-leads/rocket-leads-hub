const currencyFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
})

const currencyDecimalFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat("en-GB")

export function formatCurrency(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "€0"
  return currencyFormatter.format(n)
}

export function formatCurrencyDecimal(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "€0.00"
  return currencyDecimalFormatter.format(n)
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "0"
  return numberFormatter.format(n)
}

export function formatPercent(n: number | null | undefined): string {
  if (n == null || isNaN(n) || !isFinite(n)) return "0.0%"
  return `${(n * 100).toFixed(1)}%`
}

export function formatMultiplier(n: number | null | undefined): string {
  if (n == null || isNaN(n) || !isFinite(n)) return "0.0×"
  return `${n.toFixed(1)}×`
}

export function safeDivide(a: number, b: number): number {
  if (!b || b === 0) return 0
  return a / b
}
