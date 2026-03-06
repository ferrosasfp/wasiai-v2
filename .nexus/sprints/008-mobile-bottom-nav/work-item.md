# Work Item #008 — WAS-48: Bottom navigation bar mobile completa

| Campo | Valor |
|-------|-------|
| **#** | 008 |
| **Linear** | WAS-48 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Completar la bottom navigation bar mobile para que todos los tabs (Home, Explorar, Dashboard, Perfil) funcionen correctamente, con el tab activo bien resaltado y sin bugs de navegación. Actualmente hay bugs conocidos: tab Explorar marca Home como activo, tab Perfil no tiene destino claro. |
| **Reglas de negocio** | 4 tabs: Home (/) · Explorar (#agents en /) · Dashboard (/creator/dashboard) · Perfil (/profile). Tab activo resaltado en rojo Avalanche (#E84142). Solo visible en mobile (<640px). |
| **Scope IN** | MobileBottomNav.tsx. Corrección de lógica isActive. Tab Perfil → /profile. |
| **Scope OUT** | Desktop navbar. Página /profile internamente. Wallet connect en mobile (WAS-45 lo cubre). |

## Acceptance Criteria

| # | AC | Formato EARS |
|---|---|---|
| 1 | WHEN el usuario está en /, THE tab "Home" SHALL estar resaltado en rojo y "Explorar" no | |
| 2 | WHEN el usuario hace click en "Explorar", THE página SHALL hacer scroll a #agents Y el tab SHALL resaltarse | |
| 3 | WHEN el usuario hace click en "Perfil", THE app SHALL navegar a /[locale]/profile | |
| 4 | WHEN el usuario está en /creator/dashboard, THE tab "Dashboard" SHALL estar resaltado | |
| 5 | WHILE el usuario está en mobile (<640px), THE bottom nav SHALL ser visible y fija al fondo | |
