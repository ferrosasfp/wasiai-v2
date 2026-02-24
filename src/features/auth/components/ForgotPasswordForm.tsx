'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { resetPassword } from '@/actions/auth'

export function ForgotPasswordForm() {
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState(false)
    const [loading, setLoading] = useState(false)
    const t = useTranslations('auth')

    async function handleSubmit(formData: FormData) {
        setLoading(true)
        setError(null)

        const result = await resetPassword(formData)

        if (result?.error) {
            setError(result.error)
            setLoading(false)
        } else {
            setSuccess(true)
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="text-center">
                <p className="text-green-600">{t('resetLinkSent')}</p>
            </div>
        )
    }

    return (
        <form action={handleSubmit} className="space-y-4">
            <div>
                <label htmlFor="email" className="block text-sm font-medium">
                    {t('email')}
                </label>
                <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-avax-400 focus:outline-none focus:ring-1 focus:ring-avax-400"
                />
            </div>

            {error && (
                <p className="text-sm text-red-600">{error}</p>
            )}

            <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-avax-500 px-4 py-2 text-white hover:bg-avax-600 disabled:opacity-50"
            >
                {loading ? t('sending') : t('sendResetLink')}
            </button>
        </form>
    )
}
