import { Platform } from 'react-native';
import Constants from 'expo-constants';
import type { PurchasesPackage } from 'react-native-purchases';
import { api, FreeTrial } from './api';

const publicKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
const productId = process.env.EXPO_PUBLIC_IOS_SUBSCRIPTION_PRODUCT_ID ?? 'fridgeout_pro_monthly';
let initialized = false;
let identifiedUser = '';

export function billingAvailable() {
  return Platform.OS === 'ios' && Constants.executionEnvironment !== 'storeClient' && !!publicKey;
}
async function identify(userId: string) {
  if (!billingAvailable()) throw new Error('Purchases require the iOS app build with subscriptions configured.');
  const { default: Purchases } = await import('react-native-purchases');
  if (!initialized) {
    Purchases.configure({ apiKey: publicKey, appUserID: userId });
    initialized = true;
    identifiedUser = userId;
  } else if (identifiedUser !== userId) {
    await Purchases.logIn(userId);
    identifiedUser = userId;
  }
  return Purchases;
}

export async function monthlyPackage(userId: string): Promise<PurchasesPackage> {
  const Purchases = await identify(userId);
  const offerings = await Purchases.getOfferings();
  const pack = offerings.current?.availablePackages.find(item => item.product.identifier === productId);
  if (!pack) throw new Error('The monthly plan is not available in the App Store yet.');
  if (pack.product.subscriptionPeriod !== 'P1M' || pack.product.productCategory !== 'SUBSCRIPTION') {
    throw new Error('The store product must be a one-month subscription.');
  }
  return pack;
}
export async function buyMonthly(userId: string, pack: PurchasesPackage): Promise<FreeTrial | null> {
  const Purchases = await identify(userId);
  try { await Purchases.purchasePackage(pack); }
  catch (error) {
    if ((error as { userCancelled?: boolean }).userCancelled) return null;
    throw error;
  }
  // The backend verifies the subscription with RevenueCat. Never trust local entitlements.
  return api<FreeTrial>('/billing/sync', 'POST');
}
export async function restorePurchases(userId: string): Promise<FreeTrial> {
  const Purchases = await identify(userId);
  await Purchases.restorePurchases();
  return api<FreeTrial>('/billing/sync', 'POST');
}
export async function syncPurchases(userId: string) {
  await identify(userId);
  return api<FreeTrial>('/billing/sync', 'POST');
}
