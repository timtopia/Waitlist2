"use client"

import Image from "next/image"
import Link from "next/link"
import { Card, CardContent, CardHeader } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"

interface UserData {
  id: string
  name: string | null
  email: string | null
  image: string | null
  createdAt: string
}

interface Stats {
  linesCreated: number
  activePositions: number
  totalTransactions: number
  sellerBalance: number
  pendingSellerEarnings: number
  ownerBalance: number
  pendingOwnerEarnings: number
  purchaseCount: number
  saleCount: number
}

interface Transaction {
  id: string
  amount: number
  status: string
  role: "buyer" | "seller"
  createdAt: string
  settledAt: string | null
}

interface ProfileClientProps {
  user: UserData
  stats: Stats
  recentTransactions: Transaction[]
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

const statusColors: Record<string, string> = {
  COMPLETED: "bg-green-100 text-green-700",
  PENDING: "bg-yellow-100 text-yellow-700",
  FAILED: "bg-red-100 text-red-700",
  REFUNDED: "bg-gray-100 text-gray-700",
}

export function ProfileClient({ user, stats, recentTransactions }: ProfileClientProps) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* User Info */}
      <Card className="mb-6">
        <CardContent className="py-6">
          <div className="flex items-center gap-4">
            {user.image ? (
              <Image
                src={user.image}
                alt={user.name || "User"}
                width={64}
                height={64}
                className="rounded-full"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold">
                {user.name?.[0] || "U"}
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900">{user.name || "Anonymous"}</h1>
              {user.email && (
                <p className="text-sm text-gray-500">{user.email}</p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                Member since {formatDate(user.createdAt)}
              </p>
            </div>
            <Link href="/dashboard">
              <Button variant="secondary" size="sm">Dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.linesCreated}</p>
            <p className="text-xs text-gray-500 mt-1">Lines Created</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.activePositions}</p>
            <p className="text-xs text-gray-500 mt-1">Active Positions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.purchaseCount}</p>
            <p className="text-xs text-gray-500 mt-1">Positions Bought</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{stats.saleCount}</p>
            <p className="text-xs text-gray-500 mt-1">Positions Sold</p>
          </CardContent>
        </Card>
      </div>

      {/* Financial Summary */}
      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900">Financial Summary</h2>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-green-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-green-700">${stats.sellerBalance.toFixed(2)}</p>
              <p className="text-sm text-green-600">Seller Balance</p>
              {stats.pendingSellerEarnings > 0 && (
                <p className="text-xs text-green-400 mt-1">
                  +${stats.pendingSellerEarnings.toFixed(2)} pending
                </p>
              )}
            </div>
            <div className="bg-blue-50 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-blue-700">${stats.ownerBalance.toFixed(2)}</p>
              <p className="text-sm text-blue-600">Line Owner Balance</p>
              {stats.pendingOwnerEarnings > 0 && (
                <p className="text-xs text-blue-400 mt-1">
                  +${stats.pendingOwnerEarnings.toFixed(2)} pending
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-gray-900">
            Recent Transactions ({stats.totalTransactions} total)
          </h2>
        </CardHeader>
        <CardContent>
          {recentTransactions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-2">No transactions yet.</p>
              <p className="text-sm text-gray-400">
                Buy or sell a position in a line to see your transaction history here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      tx.role === "buyer" ? "bg-red-100" : "bg-green-100"
                    }`}>
                      {tx.role === "buyer" ? (
                        <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {tx.role === "buyer" ? "Bought position" : "Sold position"}
                      </p>
                      <p className="text-xs text-gray-500">{formatDateTime(tx.createdAt)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[tx.status] || "bg-gray-100 text-gray-600"}`}>
                      {tx.status}
                    </span>
                    <p className={`text-sm font-bold ${
                      tx.role === "buyer" ? "text-red-600" : "text-green-600"
                    }`}>
                      {tx.role === "buyer" ? "-" : "+"}${tx.amount.toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
