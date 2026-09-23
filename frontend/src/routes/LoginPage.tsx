import { AlertCircle, Loader2 } from 'lucide-react'
import * as React from 'react'
import { Navigate, useNavigate } from 'react-router-dom'

import { Logo } from '@/components/Logo'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (user) return <Navigate to="/" replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(
        err instanceof ApiError && err.message
          ? err.message
          : 'No pudimos iniciar sesión. Revisá el correo y la contraseña.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.05fr]">
      <div className="relative flex flex-col justify-center px-6 py-10 sm:px-12">
        <div className="absolute top-5 right-5">
          <ThemeToggle collapsed />
        </div>

        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5">
            <Logo variant="horizontal" size={64} />
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Entrá a tu bandeja</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Usá la cuenta que creaste con <code className="font-mono text-[12px]">create_user</code>.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                placeholder="vos@tuempresa.com"
                aria-invalid={!!error}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                aria-invalid={!!error}
                aria-describedby={error ? 'login-error' : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {/* El error va junto al formulario, no en un toast que se va solo */}
            {error && (
              <p
                id="login-error"
                role="alert"
                className="flex items-start gap-2 rounded-md bg-destructive-soft px-3 py-2 text-[13px] text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            )}

            <Button type="submit" size="lg" disabled={submitting} className="mt-1">
              {submitting && <Loader2 className="animate-spin" />}
              {submitting ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </div>
      </div>

      <div className="relative hidden overflow-hidden border-l border-border bg-surface lg:block">
        <div className="weave-bg absolute inset-0 opacity-70" />
        <Logo
          variant="mark"
          size={340}
          className="pointer-events-none absolute -right-24 -bottom-24 text-foreground/[0.04]"
          accent="currentColor"
        />
        <div className="relative flex h-full flex-col justify-center gap-6 px-14">
          <p className="max-w-md text-[26px] leading-snug font-semibold tracking-tight text-balance">
            Tu número de WhatsApp, tu modelo, tu base de datos, tu servidor.
          </p>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Telar recibe los mensajes de Meta, los pasa por tu agente de LangGraph y devuelve la
            respuesta. Cuando el caso necesita una persona, el agente suelta la conversación y no
            vuelve a hablar hasta que el asesor la cierre.
          </p>
          <ul className="flex flex-wrap gap-2 pt-1">
            {['Handoff explícito', 'Bases de conocimiento', 'Tools propias', 'Open source'].map(
              (item) => (
                <li
                  key={item}
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {item}
                </li>
              ),
            )}
          </ul>
        </div>
      </div>
    </div>
  )
}
