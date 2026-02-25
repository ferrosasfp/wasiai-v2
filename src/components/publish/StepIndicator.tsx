'use client'

import { useTranslations } from 'next-intl'

interface Props {
  currentStep: 1 | 2 | 3
}

export function StepIndicator({ currentStep }: Props) {
  const t = useTranslations('publish.steps')

  const steps = [
    { num: 1, label: t('basic') },
    { num: 2, label: t('product') },
    { num: 3, label: t('technical') },
  ] as const

  return (
    <div className="flex items-center justify-center">
      {steps.map((step, idx) => (
        <div key={step.num} className="flex items-center">
          {/* Step circle */}
          <div className="flex flex-col items-center">
            <div
              className={[
                'flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors',
                currentStep === step.num
                  ? 'bg-avax-500 text-white shadow-sm'
                  : currentStep > step.num
                    ? 'bg-avax-100 text-avax-700'
                    : 'bg-gray-100 text-gray-400',
              ].join(' ')}
            >
              {currentStep > step.num ? '✓' : step.num}
            </div>
            <span
              className={[
                'mt-1.5 text-xs font-medium',
                currentStep === step.num
                  ? 'text-avax-600'
                  : currentStep > step.num
                    ? 'text-avax-500'
                    : 'text-gray-400',
              ].join(' ')}
            >
              {step.label}
            </span>
          </div>

          {/* Connector line (not after last step) */}
          {idx < steps.length - 1 && (
            <div
              className={[
                'mx-3 mb-5 h-0.5 w-16 transition-colors',
                currentStep > step.num ? 'bg-avax-300' : 'bg-gray-200',
              ].join(' ')}
            />
          )}
        </div>
      ))}
    </div>
  )
}
