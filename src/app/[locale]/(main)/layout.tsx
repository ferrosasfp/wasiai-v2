// NavBar is provided by /[locale]/layout.tsx (WasiNavBar)
// No second navbar here to avoid double-render on authenticated pages

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <main>{children}</main>
    </div>
  )
}
