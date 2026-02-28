// NavBar is provided by /[locale]/layout.tsx (WasiNavBar)
// No second navbar here to avoid double-render on authenticated pages

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="pb-20 sm:pb-0">{children}</main>
    </div>
  )
}
