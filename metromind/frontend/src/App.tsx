import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { CommandPalette } from '@/components/CommandPalette'
import { AppShell } from '@/components/layout/AppShell'
import { Shortcuts } from '@/components/Shortcuts'
import { Button, Callout, Skeleton, TooltipProvider } from '@/components/ui'
import { STATIC_MODE } from '@/lib/inbrowser'
import { PrefsProvider, usePrefs } from '@/lib/prefs'
import Landing from '@/pages/Landing'
import NotFound from '@/pages/NotFound'

const Planner = lazy(() => import('@/pages/Planner'))
const Lab = lazy(() => import('@/pages/Lab'))
const Compare = lazy(() => import('@/pages/Compare'))
const Explorer = lazy(() => import('@/pages/Explorer'))
const Analytics = lazy(() => import('@/pages/Analytics'))
const DataPage = lazy(() => import('@/pages/Data'))
const Settings = lazy(() => import('@/pages/Settings'))

const Router = STATIC_MODE ? HashRouter : BrowserRouter

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false }, mutations: { retry: 0 } },
})

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error)
      return (
        <div className="mx-auto max-w-lg p-8">
          <Callout
            tone="danger"
            title="Something went wrong on this page"
            action={
              <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
                Try again
              </Button>
            }
          >
            {this.state.error.message}
          </Callout>
        </div>
      )
    return this.props.children
  }
}

function PageFallback() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

function AppToaster() {
  const { isDark } = usePrefs()
  return (
    <Toaster
      theme={isDark ? 'dark' : 'light'}
      position="bottom-right"
      toastOptions={{ className: '!rounded-xl !border !shadow-float !font-sans' }}
    />
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PrefsProvider>
        <TooltipProvider>
          <Router>
            <CommandPalette />
            <Shortcuts />
            <AppToaster />
            <AppShell>
              <ErrorBoundary>
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/plan" element={<Planner />} />
                    <Route path="/lab" element={<Lab />} />
                    <Route path="/compare" element={<Compare />} />
                    <Route path="/explore" element={<Explorer />} />
                    <Route path="/analytics" element={<Analytics />} />
                    <Route path="/data" element={<DataPage />} />
                    <Route path="/settings" element={<Settings />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </AppShell>
          </Router>
        </TooltipProvider>
      </PrefsProvider>
    </QueryClientProvider>
  )
}
