import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { useQueryClient } from '@tanstack/react-query';
import { billingAvailable, monthlyPackage, buyMonthly, restorePurchases, syncPurchases } from './billing';
import { FreeTrial } from './api';
import { palette } from './theme';

export function SubscriptionCard({ userId, status, onBusyChange }: { userId: string; status?: FreeTrial; onBusyChange: (busy: boolean) => void }) {
  const queryClient = useQueryClient();
  const [pack, setPack] = useState<PurchasesPackage | null>(null);
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const [message, setMessage] = useState('');
  const available = billingAvailable();
  const privacy = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? '';
  useEffect(() => {
    let current = true;
    if (available) {
      monthlyPackage(userId).then(value => { if (current) setPack(value); })
        .catch(error => { if (current) setMessage(error instanceof Error ? error.message : 'Unable to load the monthly plan.'); });
      syncPurchases(userId).then(value => {
        if (current) queryClient.setQueryData(['chef-free-trial', userId], value);
      }).catch(() => { /* Existing free trial remains available during a store outage. */ });
    }
    return () => { current = false; };
  }, [userId, available, queryClient]);
  async function perform(name: string, action: () => Promise<FreeTrial | null>) {
    if (lock.current) return;
    lock.current = true; onBusyChange(true);
    setBusy(name); setMessage('');
    try {
      const result = await action();
      if (result) {
        queryClient.setQueryData(['chef-free-trial', userId], result);
        setMessage(result.subscribed ? 'Subscription verified. Your monthly uses are ready.' : 'No active subscription found for this account.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Purchase verification failed. Use Restore purchases to check again.'); }
    finally { lock.current = false; setBusy(''); onBusyChange(false); }
  }
  return <View style={{ gap: 12, padding: 20, backgroundColor: palette.cream, borderRadius: 20, borderWidth: 1, borderColor: palette.line }}>
    <Text style={{ color: palette.ink, fontSize: 22, fontWeight: '700' }}>FridgeOut Plus</Text>
    <Text style={{ color: palette.muted }}>20 kitchen runs per monthly billing period. Each scan includes one recipe generation and up to five dish images. Generating directly uses one run.</Text>
    {status?.subscribed && <Text style={{ color: palette.ink }}>{status.monthly_remaining} of {status.monthly_uses} monthly runs remaining{status.period_ends_at ? ` · Renews or expires ${new Date(status.period_ends_at).toLocaleDateString()}` : ''}</Text>}
    {pack && <Text style={{ color: palette.ink, fontSize: 18 }}>{pack.product.priceString} / month</Text>}
    <Text style={{ color: palette.muted, fontSize: 12 }}>Auto-renewing monthly subscription. Unused runs do not roll over. Failed AI attempts may still use a run. Manage or cancel in your Apple account.</Text>
    {!available && <Text style={{ color: palette.muted }}>Subscriptions will be available in the configured iOS app. Expo Go, web and Android cannot purchase this plan.</Text>}
    {available && !status?.subscribed && <Pressable accessibilityRole="button" disabled={!pack || !!busy || !privacy} onPress={() => { if (pack) void perform('purchase', () => buyMonthly(userId, pack)); }} style={{ padding: 14, backgroundColor: palette.orange, borderRadius: 12, opacity: !pack || busy || !privacy ? .5 : 1 }}>
      {busy === 'purchase' ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', textAlign: 'center', fontWeight: '700' }}>Subscribe monthly</Text>}
    </Pressable>}
    {available && <Pressable accessibilityRole="button" disabled={!!busy} onPress={() => { void perform('restore', () => restorePurchases(userId)); }}><Text style={{ color: palette.ink }}>{busy === 'restore' ? 'Checking purchases…' : 'Restore purchases'}</Text></Pressable>}
    <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://apps.apple.com/account/subscriptions'); }}><Text style={{ color: palette.ink }}>Manage subscription</Text></Pressable>
    <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/'); }}><Text style={{ color: palette.ink }}>Terms of Use</Text></Pressable>
    {privacy ? <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(privacy); }}><Text style={{ color: palette.ink }}>Privacy Policy</Text></Pressable> : <Text style={{ color: palette.muted }}>Purchases are unavailable until the privacy policy is configured.</Text>}
    {!!message && <Text accessibilityRole="alert" style={{ color: palette.ink }}>{message}</Text>}
  </View>;
}
