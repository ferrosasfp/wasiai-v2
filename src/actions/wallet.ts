'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { isAddress } from 'viem'

// A-12: Use viem's isAddress() for EVM address validation (checksum-aware)
const addressSchema = z.string().refine(
  (val) => isAddress(val),
  { message: 'Invalid Ethereum address' },
)

export async function linkWallet(walletAddress: string) {
    const validated = addressSchema.safeParse(walletAddress)
    if (!validated.success) {
        return { error: validated.error.issues[0].message }
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return { error: 'Not authenticated' }
    }

    // Check if wallet is already linked to another user
    const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('wallet_address', validated.data)
        .neq('id', user.id)
        .maybeSingle()

    if (existing) {
        return { error: 'This wallet address is already linked to another account' }
    }

    const { error } = await supabase
        .from('profiles')
        .update({
            wallet_address: validated.data,
            updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

    if (error) {
        return { error: error.message }
    }

    // HU-069: Always sync connected wallet → creator_profiles.wallet_address
    // Block if creator has pending earnings on a different wallet.
    const { data: creatorProfile } = await supabase
        .from('creator_profiles')
        .select('id, wallet_address, pending_earnings_usdc')
        .eq('id', user.id)
        .maybeSingle()

    if (creatorProfile) {
        const isNewWallet = creatorProfile.wallet_address &&
            creatorProfile.wallet_address.toLowerCase() !== validated.data.toLowerCase()
        const hasPending = Number(creatorProfile.pending_earnings_usdc ?? 0) > 0

        if (isNewWallet && hasPending) {
            // Don't block the profile link — just skip creator_profiles sync
            // Creator must withdraw first, then reconnect to update
        } else {
            await supabase
                .from('creator_profiles')
                .update({ wallet_address: validated.data })
                .eq('id', user.id)
        }
    }

    return { success: true }
}

export async function unlinkWallet() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return { error: 'Not authenticated' }
    }

    const { error } = await supabase
        .from('profiles')
        .update({
            wallet_address: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

    if (error) {
        return { error: error.message }
    }

    return { success: true }
}

export async function saveSmartAccount(smartAccountAddress: string) {
    const validated = addressSchema.safeParse(smartAccountAddress)
    if (!validated.success) {
        return { error: validated.error.issues[0].message }
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return { error: 'Not authenticated' }
    }

    // Check if smart account is already linked to another user
    const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('smart_account_address', validated.data)
        .neq('id', user.id)
        .maybeSingle()

    if (existing) {
        return { error: 'This smart account address is already linked to another account' }
    }

    const { error } = await supabase
        .from('profiles')
        .update({
            smart_account_address: validated.data,
            updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)

    if (error) {
        return { error: error.message }
    }

    return { success: true }
}

export async function getWalletInfo() {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return { error: 'Not authenticated' }
    }

    const { data, error } = await supabase
        .from('profiles')
        .select('wallet_address, smart_account_address')
        .eq('id', user.id)
        .single()

    if (error) {
        return { error: error.message }
    }

    return {
        walletAddress: data.wallet_address,
        smartAccountAddress: data.smart_account_address,
    }
}
