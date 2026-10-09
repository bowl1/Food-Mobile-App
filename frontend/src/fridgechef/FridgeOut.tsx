import { brand } from './brand';
import { paidGenerate, FreeTrial } from './api';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { api, defaults, DEMO, Food, Preferences, Recipe, restoreSession, Session, signIn, signOut } from './api';

import { clearKitchenCache, restoreKitchenCache, watchKitchenCache } from './cache';
import { RecipePhoto } from './RecipePhoto';
import { PaperTexture, SketchBorder } from './SketchPaper';
import { sortFavorites } from './favorites';
import { HandDrawnIcon } from './HandDrawnIcon';
import { brandLogo, foodArt, kitchenArt, palette } from './theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type DraftFood = Omit<Partial<Food>, 'quantity'> & { quantity?: number | string };
type Tab = 'Kitchen' | 'Recipes' | 'Favorite' | 'You';
const green = palette.ink;
const dietaryLabels: [keyof Omit<Preferences, 'max_cooking_time'>, string, string][] = [
  ['vegetarian', 'Vegetarian', 'No meat or fish'], ['vegan', 'Vegan', 'All plant-based'], ['keto', 'Keto', 'Limit high-carb ingredients'],
  ['gluten_free', 'Gluten-free', 'Skip gluten-containing foods'], ['dairy_free', 'Dairy-free', 'No milk or dairy'], ['high_protein', 'High-protein', 'Prefer protein-rich meals'],
];
const handDrawnIcons: Partial<Record<IconName, string>> = {
  basket: 'fridge', 'basket-outline': 'fridge',
  restaurant: 'bowl', 'restaurant-outline': 'bowl',
  book: 'book', 'book-outline': 'book',
  person: 'chef', 'person-outline': 'chef',
  flower: 'mushroom', leaf: 'leaf', egg: 'egg', fish: 'fish', nutrition: 'tomato',
  'camera-outline': 'camera', add: 'plus',
  sparkles: 'sparkles', 'sparkles-outline': 'sparkles',
  'checkmark-circle-outline': 'check', 'checkmark-outline': 'check', checkmark: 'check',
  'checkmark-circle': 'check', 'information-circle-outline': 'info',
  'close-circle-outline': 'close', 'flask-outline': 'flask',
  'trash-outline': 'trash', 'arrow-forward': 'arrow', 'time-outline': 'clock',
};
function Icon({ name, size = 22, color = green }: { name: IconName; size?: number; color?: string }) {
  const handDrawn = handDrawnIcons[name];
  return handDrawn ? <HandDrawnIcon name={handDrawn} size={size} color={color} /> : <Ionicons name={name} size={size} color={color} />;
}
function Button({ label, onPress, busy = false, secondary = false, disabled = false, icon }: { label: string; onPress: () => void; busy?: boolean; secondary?: boolean; disabled?: boolean; icon?: IconName }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, (busy || disabled) && { opacity: .5 }, pressed && { opacity: .8 }]}>
    {busy ? <ActivityIndicator color={secondary ? green : '#fff'} /> : icon && <Icon name={icon} color={secondary ? green : '#fff'} size={19} />}
    <Text style={[s.buttonText, secondary && { color: green }]}>{label}</Text></Pressable>;
}
function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={{ flex: 1 }}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#949A91" style={s.input} {...props} /></View>;
}
function Empty({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return <View style={s.empty}><View style={s.emptyIcon}><Icon name={icon} size={32} color={palette.orange} /></View><Text style={s.cardTitle}>{title}</Text><Text style={[s.muted, { textAlign: 'center' }]}>{text}</Text></View>;
}
function foodIcon(name: string): IconName {
  if (/mushroom/i.test(name)) return 'flower';
  if (/egg|milk|cheese|yogurt/i.test(name)) return 'egg';
  if (/tomato|apple|pepper|orange|fruit/i.test(name)) return 'nutrition';
  if (/chicken|fish|meat|beef/i.test(name)) return 'fish';
  return 'leaf';
}

export function FridgeOut() {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>('Kitchen');
  const contentScroll = useRef<ScrollView>(null);
  useEffect(() => { contentScroll.current?.scrollTo({ y: 0, animated: false }); }, [tab]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [authRegister, setAuthRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [editing, setEditing] = useState<DraftFood | null>(null);
  const [drafts, setDrafts] = useState<DraftFood[] | null>(null);
  const [photo, setPhoto] = useState('');
  const [prefsDraft, setPrefsDraft] = useState<Preferences>(defaults);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [deleteRecipe, setDeleteRecipe] = useState<Recipe | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Food | null>(null);
  const enabled = !!session;
  const freeTrial = useQuery({ queryKey: ['chef-free-trial', session?.user.id], queryFn: () => api<FreeTrial>('/ai/trial'), enabled: enabled && !DEMO, staleTime: 30000 });
  const inventory = useQuery({ queryKey: ['chef-inventory', session?.user.id], queryFn: () => api<Food[]>('/inventory'), enabled });
  const preferences = useQuery({ queryKey: ['chef-preferences', session?.user.id], queryFn: () => api<Preferences>('/preferences'), enabled });
  const favorites = useQuery({ queryKey: ['chef-favorites', session?.user.id], queryFn: () => api<Recipe[]>('/recipes/favorites').then(sortFavorites), enabled, staleTime: 30000 });
  useEffect(() => {
    restoreSession().then(async next => {
      if (next && !DEMO) await restoreKitchenCache(queryClient, next.user.id);
      setSession(next);
    }).catch(e => setError(String(e))).finally(() => setBooting(false));
  }, [queryClient]);
  useEffect(() => {
    if (session && !DEMO) return watchKitchenCache(queryClient, session.user.id);
  }, [queryClient, session?.user.id]);
  useEffect(() => { if (preferences.data) setPrefsDraft(preferences.data); }, [preferences.data]);
  const foods = inventory.data ?? [];
  const activePrefs = dietaryLabels.filter(([key]) => preferences.data?.[key]);

  async function task(name: string, action: () => Promise<void>) {
    setBusy(name); setError(''); setNotice('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(''); if (name === 'photo' || name === 'generate') void queryClient.invalidateQueries({ queryKey: ['chef-free-trial'] }); }
  }
  async function refreshInventory() { await queryClient.invalidateQueries({ queryKey: ['chef-inventory'] }); }
  function checkFood(item: DraftFood) {
    if (!item.food_name?.trim() || !item.unit?.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity ?? 0) <= 0) {
      throw new Error('Add an ingredient name, a positive quantity and a unit.');
    }
    return { food_name: item.food_name.trim().toLowerCase(), quantity: Number(item.quantity), unit: item.unit.trim(), source: item.source ?? 'manual' };
  }
  async function pickPhoto(camera: boolean) {
    await task('photo', async () => {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Allow photo access in your device settings to scan ingredients.');
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: .8 };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const image = await manipulateAsync(result.assets[0].uri, [{ resize: { width: 1200 } }], { compress: .75, format: SaveFormat.JPEG, base64: true });
      if (!image.base64) throw new Error('Could not read this photo. Try another image.');
      setPhoto(image.uri);
      const detected = await api<{ foods: Food[] }>('/vision/recognize', 'POST', { image_base64: image.base64, mime_type: 'image/jpeg' });
      void queryClient.invalidateQueries({ queryKey: ['chef-free-trial'] });
      setDrafts(detected.foods.map(f => ({ ...f, source: 'image_recognition' })));
    });
  }
  async function saveDrafts() {
    await task('confirm', async () => {
      const values = (drafts ?? []).map(checkFood); // Validate everything before persisting any row.
      let saved = 0;
      try {
        for (const value of values) { await api('/inventory', 'POST', value); saved++; }
      } finally {
        setDrafts(old => old?.slice(saved) ?? null);
        await refreshInventory();
      }
      setDrafts(null); setPhoto(''); setNotice(`${saved} ingredients added to your kitchen.`);
    });
  }
  async function generate() {
    setTab('Kitchen');
    await task('generate', async () => {
      setRecipes([]);
      const data = await paidGenerate<{ recipes: Recipe[]; attempts: number; message: string }>({ inventory: [...foods].sort((a, b) => a.id.localeCompare(b.id)), preferences: preferences.data });
      void queryClient.invalidateQueries({ queryKey: ['chef-free-trial'] });
      setRecipes(data.recipes); setAttempts(data.attempts); setNotice(data.message);
    });
  }
  async function saveFavorite(item: Recipe) {
    await task(`save-${item.id}`, async () => {
      const saved = await api<Recipe>(`/recipes/${item.id}/favorite`, 'POST');
      const key = ['chef-favorites', session!.user.id];
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<Recipe[]>(key, old => sortFavorites([saved, ...(old ?? []).filter(r => r.id !== saved.id)]));
      setNotice('Saved to Favorite.');
      void queryClient.invalidateQueries({ queryKey: key });
    });
  }
  function saveButton(item: Recipe) {
    const saved = !!favorites.data?.some(r => r.id === item.id);
    return <Button label={saved ? 'Saved' : 'Save to Favorite'} icon={saved ? 'checkmark' : 'bookmark-outline'} secondary busy={busy === `save-${item.id}`} disabled={!!busy || saved} onPress={() => saveFavorite(item)} />;
  }
  function recommendations() {
    return busy === 'generate' ? <View style={[s.card, s.generating]}><SketchBorder /><HandDrawnIcon name="bowl" size={54} color={palette.orange} /><ActivityIndicator size="large" color={green} /><Text style={s.cardTitle}>A few good ideas are simmering…</Text><Text style={[s.muted, { textAlign: 'center' }]}>Loading your kitchen, checking ingredients,{ '\n' }evaluating recipes and choosing the best matches.</Text><Text style={s.small}>This may take a couple of minutes.</Text></View> : recipes.length ? <><View style={s.sectionHeading}><Text style={s.sectionTitle}>Picked for you</Text><Text style={s.small}>{attempts} generation round{attempts === 1 ? '' : 's'}</Text></View>{recipes.map((r, i) => <View key={r.id} style={{ gap: 6 }}><RecipeCard recipe={r} index={i} onPress={() => setRecipe(r)} />{saveButton(r)}</View>)}</> : <Empty icon="restaurant-outline" title="Your ingredients. New possibilities." text="Generate recipes from your confirmed inventory. Only recipes that pass ingredient, preference and quality checks appear here." />;
  }
  const queryError = inventory.error ?? preferences.error ?? (tab === 'Favorite' ? favorites.error : null);

  if (booting) return <SafeAreaView style={s.root}><PaperTexture /><View style={s.empty}><ActivityIndicator color={green} /><Text style={s.muted}>Opening your kitchen…</Text></View></SafeAreaView>;
  if (!session) return <SafeAreaView style={s.root}><PaperTexture /><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}><ScrollView contentContainerStyle={s.auth} keyboardShouldPersistTaps="handled">
    <Image source={brandLogo} accessibilityLabel={`${brand.name} logo`} style={s.brandMark} /><Text style={s.wordmark}>{brand.name}<Text style={{ color: palette.orange }}>.</Text></Text>
    <Text style={s.brandDescriptor}>{brand.descriptor}</Text><Text style={s.brandTagline}>{brand.tagline}</Text><Text style={[s.title, { textAlign: 'center', marginTop: 8 }]}>Good food from{ '\n' }what’s left.</Text>
    <Image source={foodArt} accessible={false} style={s.authArt} resizeMode="contain" /><Text style={[s.muted, { textAlign: 'center', marginBottom: 10 }]}>Turn the ingredients left in your fridge into recipes you’ll love.{ '\n' }Use more. Waste less.</Text>
    <View style={[s.card, { width: '100%' }]}><SketchBorder /><Text style={s.cardTitle}>{authRegister ? 'Create your kitchen' : 'Welcome to your kitchen'}</Text>
      <Field label="Email address" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={authRegister ? 'new-password' : 'current-password'} placeholder="At least 8 characters" />
      {!!error && <Text accessibilityRole="alert" style={s.errorText}>{error}</Text>}{!!notice && <Text style={s.muted}>{notice}</Text>}
      <Button label={authRegister ? 'Create account' : 'Sign in'} busy={!!busy} onPress={() => task('auth', async () => {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error('Enter a valid email address.');
        if (!password) throw new Error('Enter your password.');
        if (authRegister && password.length < 8) throw new Error('Use at least 8 characters for your password.');
        const next = await signIn(email, password, authRegister);
        if (next) { queryClient.clear(); if (!DEMO) await restoreKitchenCache(queryClient, next.user.id); setSession(next); if (authRegister) setTab('You'); }
        else { setAuthRegister(false); setPassword(''); setNotice('Check your email (including spam) to confirm your account, then sign in.'); }
      })} />
      <Pressable accessibilityRole="button" onPress={() => { setAuthRegister(!authRegister); setError(''); setNotice(''); }}><Text style={s.link}>{authRegister ? 'Already have an account? Sign in' : 'New here? Create an account'}</Text></Pressable>
    </View><Text style={s.footnote}>Only your ingredients. Always your kitchen.</Text>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;

  return <SafeAreaView style={s.root} edges={['top', 'left', 'right']}><PaperTexture />
    <View style={s.header}><View style={s.row}><Image source={brandLogo} accessibilityLabel={`${brand.name} logo`} style={s.smallMark} /><View style={s.brandLockup}><Text style={s.headerBrand}>{brand.name}<Text style={{ color: palette.orange }}>.</Text></Text><Text style={s.headerDescriptor}>{brand.descriptor}</Text></View></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open preferences" style={s.avatar} onPress={() => setTab('You')}><Icon name="person-outline" size={19} /></Pressable></View>
    {DEMO && <View style={s.demo}><Icon name="flask-outline" size={15} /><Text style={s.demoText}>LOCAL DEMO · sample recognition & recipe scores</Text></View>}
    <ScrollView ref={contentScroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      {(!!error || !!queryError) && <View accessibilityRole="alert" style={s.error}><Text style={s.errorText}>{error || (queryError as Error).message}</Text><Pressable onPress={() => { setError(''); inventory.refetch(); preferences.refetch(); if (tab === 'Favorite') favorites.refetch(); }}><Text style={s.link}>Try again</Text></Pressable></View>}
      {!DEMO && freeTrial.data && <View style={s.notice}><Icon name="sparkles-outline" size={20} /><View style={{ flex: 1 }}><Text style={s.foodName}>{freeTrial.data.exhausted ? 'You’ve used all your free tries' : `${freeTrial.data.remaining_uses} of ${freeTrial.data.total_uses} free tries remaining`}</Text><Text style={s.small}>Recipes and dish images included. No expiry. Free tries do not reset.</Text></View></View>}
      {!!notice && <View style={s.notice}><Icon name="information-circle-outline" size={20} /><Text style={[s.muted, { flex: 1 }]}>{notice}</Text></View>}
      {tab === 'Kitchen' && <>
        <Text style={s.eyebrow}>{brand.tagline}</Text><Text style={s.title}>What’s left in{ '\n' }your fridge?</Text><Text style={s.muted}>Turn your remaining ingredients into a delicious meal. Use them up, waste less.</Text>
        <View style={s.hero}><SketchBorder /><View style={s.heroArt}><Image source={kitchenArt} accessible={false} style={s.heroImage} resizeMode="contain" /><View style={s.heroBadge}><View style={s.dot} /><Text style={s.badgeText}>No extra shopping</Text></View></View>
          <Text style={s.heroTitle}>Use what’s left.</Text><Text style={[s.muted, { textAlign: 'center', marginBottom: 18 }]}>Snap what’s left. Confirm your ingredients.{ '\n' }Find a recipe that puts them to use.</Text>
          <Button label="Scan my ingredients" icon="camera-outline" busy={busy === 'photo'} disabled={!!busy} onPress={() => pickPhoto(true)} />
          <Pressable disabled={!!busy} accessibilityRole="button" onPress={() => pickPhoto(false)}><View style={[s.row, { justifyContent: 'center', gap: 6 }]}><Text style={s.link}>Choose from photo library</Text><Icon name="arrow-forward" size={15} /></View></Pressable>
        </View>
        <View style={s.sectionHeading}><View><Text style={s.sectionTitle}>In your kitchen <Text style={s.count}>{foods.length}</Text></Text><Text style={s.small}>Confirmed ingredients, ready for inspiration</Text></View>
          <Pressable disabled={!!busy} accessibilityRole="button" accessibilityLabel="Add ingredient" onPress={() => setEditing({ food_name: '', quantity: 1, unit: 'piece', source: 'manual' })} style={s.add}><Icon name="add" /></Pressable></View>
        {inventory.isFetching && !inventory.isLoading && <Text style={s.small}>Syncing your kitchen…</Text>}
        {inventory.isLoading ? <ActivityIndicator color={green} /> : foods.length === 0 ? <Empty icon="basket-outline" title="Start with what you have" text="Add the ingredients left in your fridge. We’ll help you turn them into a meal." /> :
          <View style={s.card}><SketchBorder />{foods.map((food, index) => <View key={food.id} style={[s.foodRow, index > 0 && s.divider]}>
            <View style={[s.foodIcon, { backgroundColor: index % 2 ? palette.sage : palette.apricot, transform: [{ rotate: index % 2 ? '4deg' : '-4deg' }] }]}><Icon name={foodIcon(food.food_name)} size={25} color={index % 2 ? palette.leaf : palette.orange} /></View><Pressable disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Edit ${food.food_name}`} style={{ flex: 1 }} onPress={() => setEditing(food)}><Text style={s.foodName}>{food.food_name}</Text><Text style={s.small}>{food.quantity} {food.unit} · {food.source === 'manual' ? 'Added by you' : 'Photo confirmed'}</Text></Pressable>
            <Pressable disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Mark ${food.food_name} consumed`} style={s.iconButton} onPress={() => task('consume', async () => { await api(`/inventory/${food.id}`, 'PATCH', { consumed: true }); await refreshInventory(); })}><Icon name="checkmark-circle-outline" size={22} /></Pressable>
            <Pressable disabled={!!busy} accessibilityRole="button" accessibilityLabel={`Delete ${food.food_name}`} style={s.iconButton} onPress={() => setConfirmDelete(food)}><Icon name="trash-outline" size={18} color="#A49B90" /></Pressable>
          </View>)}</View>}
        <View style={s.staples}><Icon name="sparkles-outline" size={18} /><Text style={[s.small, { flex: 1 }]}>The basics are covered: salt, black pepper, water & cooking oil.</Text></View>
        <Button label="Find something to cook" icon="sparkles-outline" busy={busy === 'generate'} disabled={!!busy || !foods.length || !preferences.data} onPress={generate} />
        <Text style={s.footnote}>Made for your ingredients. Checked for your preferences.</Text>
        {(busy === 'generate' || recipes.length > 0) && <View style={{ gap: 18 }} onLayout={event => { if (recipes.length > 0 && busy !== 'generate') contentScroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: true }); }}>{recommendations()}</View>}
      </>}
      {tab === 'Recipes' && <>
        <Text style={s.eyebrow}>A LITTLE KITCHEN INSPIRATION</Text><Text style={s.title}>Your next{ '\n' }delicious idea.</Text><Text style={s.muted}>Recipes that put your remaining ingredients to delicious use.</Text>
        <View style={s.chips}>{activePrefs.map(([key, label]) => <View key={key} style={s.chip}><Icon name="checkmark" size={13} /><Text style={s.chipText}>{label}</Text></View>)}<View style={s.chip}><Icon name="time-outline" size={13} /><Text style={s.chipText}>{preferences.data?.max_cooking_time ?? 30} min max</Text></View></View>
        {recommendations()}
        {recipes.length === 0 && <Button label="Generate my recipes" busy={busy === 'generate'} disabled={!!busy || !foods.length || !preferences.data} icon="sparkles-outline" onPress={generate} />}
        {!foods.length && <Button label="Add ingredients first" secondary onPress={() => setTab('Kitchen')} />}
      </>}
      {tab === 'Favorite' && <>
        <Text style={s.eyebrow}>YOUR SAVED RECIPES</Text><Text style={s.title}>Good ideas,{ '\n' }worth keeping.</Text><Text style={s.muted}>Recipes you choose to save, all in one place.{ '\n' }Saved recipes reflect the inventory at generation time.</Text>
        {favorites.isFetching && !favorites.isLoading && <Text style={s.small}>Syncing your favorites…</Text>}
        {favorites.isLoading ? <ActivityIndicator color={green} /> : favorites.data?.length ? favorites.data.map((r, i) => <View key={r.id} style={{ gap: 4 }}><RecipeCard recipe={r} index={i} onPress={() => setRecipe(r)} favorites /><Pressable accessibilityRole="button" accessibilityLabel={`Delete ${r.recipe_name}`} disabled={!!busy} onPress={() => { setError(''); setDeleteRecipe(r); }} style={[s.row, { alignSelf: 'flex-end', padding: 12 }]}><Icon name="trash-outline" size={17} color="#A34F3D" /><Text style={{ color: '#A34F3D', fontSize: 12 }}>Delete recipe</Text></Pressable></View>) : <Empty icon="book-outline" title="Your favorites start here" text="Tap Save on a generated recipe to keep it here." />}
      </>}
      {tab === 'You' && <>
        <Text style={s.eyebrow}>A KITCHEN THAT KNOWS YOU</Text><Text style={s.title}>Your taste.{ '\n' }Your way.</Text><Text style={s.muted}>Tell us what works for you. We’ll keep it in mind for every recipe.</Text>
        <View style={s.card}><SketchBorder />{dietaryLabels.map(([key, label, help], i) => <View key={key} style={[s.preferenceRow, i > 0 && s.divider]}><View style={s.preferenceArt}><HandDrawnIcon name={key === 'high_protein' ? 'egg' : key === 'keto' ? 'bowl' : 'leaf'} size={25} color={palette.leaf} /></View><View style={{ flex: 1 }}><Text style={s.foodName}>{label}</Text><Text style={s.small}>{help}</Text></View><Switch accessibilityLabel={label} value={prefsDraft[key]} trackColor={{ false: palette.line, true: '#A8B57B' }} thumbColor={prefsDraft[key] ? green : '#fff'} onValueChange={v => setPrefsDraft(p => ({ ...p, [key]: v }))} /></View>)}</View>
        <View style={s.card}><SketchBorder /><View style={s.row}><Icon name="time-outline" /><Text style={s.cardTitle}>Time on your side</Text></View><Text style={s.small}>Maximum cooking time</Text><View style={s.chips}>{[15, 30, 45, 60].map(n => <Pressable accessibilityRole="button" accessibilityState={{ selected: prefsDraft.max_cooking_time === n }} key={n} onPress={() => setPrefsDraft(p => ({ ...p, max_cooking_time: n }))} style={[s.timeChip, prefsDraft.max_cooking_time === n && { backgroundColor: green }]}><Text style={[s.chipText, prefsDraft.max_cooking_time === n && { color: '#fff' }]}>{n} min</Text></Pressable>)}</View></View>
        <Button label="Save my preferences" busy={busy === 'preferences'} disabled={!!busy} icon="checkmark-outline" onPress={() => task('preferences', async () => { await api('/preferences', 'PUT', prefsDraft); await queryClient.invalidateQueries({ queryKey: ['chef-preferences'] }); setNotice('Preferences saved. Your next recipes will use these choices.'); })} />
        <View style={[s.card, { marginTop: 16 }]}><SketchBorder /><Text style={s.cardTitle}>Your personal kitchen</Text><Text style={s.muted}>{session.user.email}</Text><Text style={s.small}>{DEMO ? 'Demo data stays in the local SQLite database.' : 'Your inventory, preferences and favorites belong to your account.'}</Text>
        {!DEMO && <Button label="Sign out" secondary disabled={!!busy} onPress={() => task('logout', async () => { await signOut(); queryClient.clear(); await clearKitchenCache(session.user.id); setSession(null); setRecipes([]); setRecipe(null); setDrafts(null); setEditing(null); setPassword(''); setTab('Kitchen'); })} />}</View>
      </>}
    </ScrollView>
    <SafeAreaView edges={['bottom']} style={s.nav}><View style={s.navInner}>{(['Kitchen', 'Recipes', 'Favorite', 'You'] as Tab[]).map((item, i) => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => { setTab(item); setNotice(''); }} style={s.navItem}><View style={[s.navIcon, tab === item && s.navSelected]}><Icon name={(['basket', 'restaurant', 'bookmark', 'person'] as IconName[])[i]} color={tab === item ? palette.orange : palette.muted} size={22} /></View><Text style={[s.navText, tab === item && { color: palette.orange, fontWeight: '700' }]}>{item}</Text></Pressable>)}</View></SafeAreaView>
    <Modal visible={editing !== null} animationType="slide" transparent onRequestClose={() => !busy && setEditing(null)}><View style={s.overlay}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheet}><PaperTexture /><SketchBorder /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }}><Text style={s.sectionTitle}>{editing?.id ? 'Edit ingredient' : 'Add an ingredient'}</Text><Text style={s.small}>Use simple English names such as egg, spinach or mushroom.</Text>
      <Field label="Ingredient" value={editing?.food_name ?? ''} onChangeText={v => setEditing(p => ({ ...p, food_name: v }))} autoCapitalize="none" placeholder="e.g. spinach" />
      <View style={s.row}><Field label="Quantity" keyboardType="decimal-pad" value={editing?.quantity === undefined ? '' : String(editing.quantity)} onChangeText={v => setEditing(p => ({ ...p, quantity: v }))} /><Field label="Unit" value={editing?.unit ?? ''} onChangeText={v => setEditing(p => ({ ...p, unit: v }))} placeholder="g, bag, piece" /></View>
      {!!error && <Text style={s.errorText}>{error}</Text>}<Button label="Save ingredient" busy={busy === 'save-food'} disabled={!!busy} onPress={() => task('save-food', async () => { const value = checkFood(editing ?? {}); const { source, ...patch } = value; await api(editing?.id ? `/inventory/${editing.id}` : '/inventory', editing?.id ? 'PATCH' : 'POST', editing?.id ? patch : value); await refreshInventory(); setEditing(null); })} /><Button label="Cancel" secondary disabled={!!busy} onPress={() => setEditing(null)} /></ScrollView></KeyboardAvoidingView></View></Modal>
    <Modal visible={drafts !== null} animationType="slide" onRequestClose={() => !busy && setDrafts(null)}><SafeAreaView style={s.root}><PaperTexture /><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Text style={s.eyebrow}>YOU HAVE THE FINAL SAY</Text><Text style={s.title}>Let’s check{ '\n' }the ingredients.</Text><Text style={s.muted}>{DEMO ? 'Demo mode shows sample items regardless of photo content.' : 'Photo recognition is an estimate. Check names, amounts and units before saving.'}</Text>{!!photo && <Image source={{ uri: photo }} style={s.preview} />}
      {drafts?.map((item, i) => <View key={i} style={s.card}><View style={s.sectionHeading}><Text style={s.small}>{item.confidence === undefined ? 'Added by you' : `${Math.round(item.confidence * 100)}% recognition confidence`}</Text><Pressable accessibilityLabel={`Remove ingredient ${i + 1}`} accessibilityRole="button" disabled={!!busy} onPress={() => setDrafts(p => p!.filter((_, n) => n !== i))}><Icon name="close-circle-outline" /></Pressable></View>
        <Field label={`Ingredient ${i + 1}`} value={item.food_name ?? ''} onChangeText={v => setDrafts(p => p!.map((f, n) => n === i ? { ...f, food_name: v } : f))} />
        <View style={s.row}><Field label="Quantity" keyboardType="decimal-pad" value={item.quantity === undefined ? '' : String(item.quantity)} onChangeText={v => setDrafts(p => p!.map((f, n) => n === i ? { ...f, quantity: v } : f))} /><Field label="Unit" value={item.unit ?? ''} onChangeText={v => setDrafts(p => p!.map((f, n) => n === i ? { ...f, unit: v } : f))} /></View></View>)}
      {!drafts?.length && <Text style={s.muted}>No ingredients yet. Add one manually or try a clearer photo.</Text>}{!!error && <Text accessibilityRole="alert" style={s.errorText}>{error}</Text>}
      <Button label="Add missing ingredient" secondary disabled={!!busy} onPress={() => setDrafts(p => [...(p ?? []), { food_name: '', quantity: 1, unit: 'piece', source: 'manual' }])} />
      <Button label={`Confirm & save ${drafts?.length ?? 0} ingredients`} busy={busy === 'confirm'} disabled={!!busy || !drafts?.length} onPress={saveDrafts} /><Button label="Discard scan" secondary disabled={!!busy} onPress={() => { setDrafts(null); setPhoto(''); }} />
    </ScrollView></SafeAreaView></Modal>
    <Modal visible={recipe !== null} animationType="slide" onRequestClose={() => setRecipe(null)}><SafeAreaView style={s.root}><PaperTexture /><ScrollView contentContainerStyle={s.content}>{recipe && <><Pressable accessibilityRole="button" onPress={() => setRecipe(null)}><Text style={s.link}>← Back to recipes</Text></Pressable><RecipePhoto recipe={recipe} detail /><Text style={s.eyebrow}>FROM YOUR KITCHEN</Text><Text style={s.title}>{recipe.recipe_name}</Text><View style={s.chips}><View style={s.chip}><Icon name="time-outline" size={15} /><Text style={s.chipText}>{recipe.cooking_time_minutes} min</Text></View><View style={s.chip}><Icon name="sparkles-outline" size={15} /><Text style={s.chipText}>{Math.round(recipe.evaluation_score * 100)}% quality score{DEMO ? ' · demo' : ''}</Text></View></View><Text style={s.muted}>{recipe.reason}</Text>
      <Text style={s.sectionTitle}>What you’ll use</Text><View style={s.card}><SketchBorder />{recipe.ingredients.map((item, i) => <View key={i} style={[s.ingredientLine, i > 0 && s.divider]}><Text style={[s.foodName, { flex: 1 }]}>{item.name}</Text><Text style={s.muted}>{item.quantity} {item.unit}</Text></View>)}</View><Text style={s.small}>Pantry basics: {recipe.pantry_staples.join(', ') || 'none'}</Text><Text style={s.sectionTitle}>Let’s make it</Text>{recipe.steps.map((step, i) => <View key={i} style={[s.row, { alignItems: 'flex-start' }]}><View style={s.step}><Text style={s.chipText}>{i + 1}</Text></View><Text style={[s.muted, { flex: 1, color: '#344236' }]}>{step}</Text></View>)}<View style={s.notice}><Icon name="checkmark-circle-outline" /><Text style={[s.small, { flex: 1 }]}>Passed inventory and dietary checks at generation time. Historical recipes may include ingredients you’ve since used.</Text></View>{saveButton(recipe)}<Button label="Back to my kitchen" onPress={() => { setRecipe(null); setTab('Kitchen'); }} /></>}</ScrollView></SafeAreaView></Modal>
    <Modal visible={!!deleteRecipe} transparent animationType="fade" onRequestClose={() => !busy && setDeleteRecipe(null)}><View style={s.overlay}><View style={s.sheet}><PaperTexture /><SketchBorder /><Text style={s.sectionTitle}>Delete {deleteRecipe?.recipe_name}?</Text><Text style={[s.muted, { marginVertical: 15 }]}>This recipe and its image will be permanently removed from Favorite.</Text>{!!error && <Text accessibilityRole="alert" style={s.errorText}>{error}</Text>}<Button label="Delete recipe" busy={busy === 'delete-recipe'} disabled={!!busy} onPress={() => task('delete-recipe', async () => {
      const id = deleteRecipe!.id;
      await api(`/recipes/favorites/${id}`, 'DELETE');
      const favoritesKey = ['chef-favorites', session!.user.id];
      await queryClient.cancelQueries({ queryKey: favoritesKey });
      queryClient.setQueryData<Recipe[]>(favoritesKey, old => (old ?? []).filter(r => r.id !== id));
      queryClient.removeQueries({ queryKey: ['chef-recipe-image', id] });
      setRecipes(old => old.filter(r => r.id !== id));
      setRecipe(old => old?.id === id ? null : old);
      setDeleteRecipe(null); setNotice('Recipe deleted.');
      void queryClient.invalidateQueries({ queryKey: favoritesKey });
    })} /><Button label="Keep recipe" secondary disabled={!!busy} onPress={() => { setDeleteRecipe(null); setError(''); }} /></View></View></Modal>
    <Modal visible={!!confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(null)}><View style={s.overlay}><View style={s.sheet}><PaperTexture /><SketchBorder /><Text style={s.sectionTitle}>Remove {confirmDelete?.food_name}?</Text><Text style={[s.muted, { marginVertical: 15 }]}>This ingredient will be removed from your inventory.</Text><Button label="Remove ingredient" busy={busy === 'delete'} onPress={() => task('delete', async () => { await api(`/inventory/${confirmDelete!.id}`, 'DELETE'); await refreshInventory(); setConfirmDelete(null); })} /><Button label="Keep ingredient" secondary disabled={!!busy} onPress={() => setConfirmDelete(null)} /></View></View></Modal>
  </SafeAreaView>;
}
function RecipeCard({ recipe, index, onPress, favorites = false }: { recipe: Recipe; index: number; onPress: () => void; favorites?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`View ${recipe.recipe_name}`} onPress={onPress} style={s.recipeCard}><View style={s.recipeArt}><RecipePhoto recipe={recipe} /><View style={s.recipeBadge}><Text style={s.badgeText}>{favorites ? new Date(recipe.created_at).toLocaleDateString() : index === 0 ? 'TOP PICK' : `IDEA ${index + 1}`}</Text></View></View><View style={{ padding: 18, gap: 10 }}><SketchBorder /><Text style={s.cardTitle}>{recipe.recipe_name}</Text><View style={s.row}><Icon name="time-outline" size={15} /><Text style={s.small}>{recipe.cooking_time_minutes} min</Text><Text style={s.small}>·</Text><Text style={s.small}>{recipe.ingredients.length} ingredients</Text><View style={{ flex: 1 }} /><Icon name="arrow-forward" size={19} /></View><Text style={s.muted} numberOfLines={2}>{recipe.reason}</Text><View style={s.row}><Icon name="checkmark-circle" size={16} /><Text style={s.chipText}>Uses your ingredients</Text></View></View></Pressable>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF8E9' }, content: { padding: 24, gap: 18, width: '100%', maxWidth: 650, alignSelf: 'center', paddingBottom: 35 },
  header: { paddingHorizontal: 24, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#E5D5B9' }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  smallMark: { width: 44, height: 44, borderRadius: 15 }, headerBrand: { fontSize: 23, fontWeight: '800', color: '#173C35', letterSpacing: -.8 }, avatar: { width: 40, height: 40, borderRadius: 15, backgroundColor: '#FBE2BA', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 10, letterSpacing: 2, fontWeight: '700', color: '#9D411E', marginTop: 8 }, title: { fontSize: 41, lineHeight: 46, letterSpacing: -1.8, color: '#173C35', fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' }, muted: { fontSize: 14, lineHeight: 22, color: '#716753' }, small: { fontSize: 12, lineHeight: 18, color: '#756851' },
  hero: { padding: 20, backgroundColor: '#FFF6DF', borderRadius: 28, borderWidth: 1, borderColor: '#E5D5B9', overflow: 'hidden' }, heroArt: { alignItems: 'center', height: 200, justifyContent: 'center' }, heroImage: { width: '100%', height: '100%' }, authArt: { width: '100%', height: 160 }, heroBadge: { position: 'absolute', bottom: 3, right: 5, padding: 10, borderRadius: 18, backgroundColor: '#FAFBF4', flexDirection: 'row', alignItems: 'center', gap: 6, transform: [{ rotate: '-5deg' }] }, dot: { width: 6, height: 6, backgroundColor: '#63835F', borderRadius: 3 }, badgeText: { fontSize: 10, fontWeight: '700', color: green, letterSpacing: .5 }, heroTitle: { fontSize: 23, color: '#173C35', fontWeight: '700', textAlign: 'center', marginTop: 15, marginBottom: 9, letterSpacing: -.5 },
  button: { minHeight: 54, borderRadius: 18, backgroundColor: palette.orange, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 9, marginTop: 4, padding: 12 }, buttonText: { color: '#fff', fontSize: 14, fontWeight: '700' }, secondary: { backgroundColor: '#E8EBCF', borderWidth: 1, borderColor: '#D3D9B6' }, link: { color: green, fontSize: 12, textAlign: 'center', paddingVertical: 13, fontWeight: '600' },
  card: { backgroundColor: '#FFFDF5', borderTopLeftRadius: 23, borderTopRightRadius: 18, borderBottomLeftRadius: 17, borderBottomRightRadius: 25, padding: 18, borderWidth: 1, borderColor: '#E5D5B9', gap: 13 }, cardTitle: { color: '#173C35', fontSize: 21, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', letterSpacing: -.3 }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, sectionTitle: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', color: '#173C35', fontWeight: '700', fontSize: 22, letterSpacing: -.6, marginTop: 8 }, count: { color: '#9D411E', fontSize: 17 }, add: { backgroundColor: '#E8EBCF', borderRadius: 13, width: 39, height: 39, alignItems: 'center', justifyContent: 'center' },
  foodRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 7 }, foodIcon: { backgroundColor: '#EFF0E6', borderRadius: 13, width: 43, height: 43, alignItems: 'center', justifyContent: 'center' }, foodName: { fontSize: 14, fontWeight: '600', color: '#173C35', textTransform: 'capitalize' }, iconButton: { padding: 7 }, divider: { borderStyle: 'dashed', borderTopWidth: 1, borderColor: '#EADCC4', paddingTop: 14 }, staples: { flexDirection: 'row', gap: 10, backgroundColor: '#F7EBD5', borderRadius: 13, padding: 14, alignItems: 'center' }, footnote: { fontSize: 10, color: '#756851', textAlign: 'center', lineHeight: 17, marginTop: 5 },
  nav: { backgroundColor: '#FFFDF5', borderTopWidth: 1, borderColor: '#E5D5B9' }, navInner: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8, maxWidth: 650, width: '100%', alignSelf: 'center' }, navItem: { alignItems: 'center', minWidth: 65, gap: 3 }, navIcon: { paddingHorizontal: 18, paddingVertical: 5, borderRadius: 16 }, navSelected: { backgroundColor: '#FBE2BA', borderWidth: 1, borderColor: '#E7B887', transform: [{ rotate: '-3deg' }] }, navText: { fontSize: 10, color: '#716753' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 11, paddingVertical: 7, borderRadius: 20, backgroundColor: '#E8EBCF' }, chipText: { fontSize: 11, color: green, fontWeight: '600' }, timeChip: { paddingVertical: 12, paddingHorizontal: 17, borderRadius: 12, backgroundColor: '#F7EBD5' }, preferenceArt: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center', marginRight: 10 }, preferenceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  empty: { paddingVertical: 35, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', gap: 15 }, emptyIcon: { backgroundColor: '#FBE2BA', width: 74, height: 74, borderRadius: 25, borderWidth: 1, borderColor: '#E7B887', transform: [{ rotate: '-6deg' }], justifyContent: 'center', alignItems: 'center' }, generating: { alignItems: 'center', paddingVertical: 40 },
  recipeCard: { backgroundColor: '#FFFDF5', borderTopLeftRadius: 25, borderTopRightRadius: 19, borderBottomLeftRadius: 18, borderBottomRightRadius: 26, borderWidth: 1, borderColor: '#E5D5B9', overflow: 'hidden' }, recipeArt: { height: 215, justifyContent: 'center', alignItems: 'center' }, recipeBadge: { position: 'absolute', top: 14, left: 14, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, backgroundColor: '#FFFDF5' }, ingredientLine: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }, step: { backgroundColor: '#E8EBCF', width: 29, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 12, color: '#5C5140', fontWeight: '600', marginBottom: 7 }, input: { borderWidth: 1, borderColor: '#D7C4A4', backgroundColor: '#FFFDF5', borderTopLeftRadius: 13, borderTopRightRadius: 10, borderBottomLeftRadius: 10, borderBottomRightRadius: 14, paddingHorizontal: 13, paddingVertical: 12, fontSize: 14, color: '#173C35', minHeight: 46 }, overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#13291F88' }, sheet: { backgroundColor: '#FFF8E9', borderTopLeftRadius: 25, borderTopRightRadius: 25, padding: 25, paddingBottom: 38, maxHeight: '90%', maxWidth: 650, width: '100%', alignSelf: 'center' }, preview: { width: '100%', height: 190, borderRadius: 18 }, error: { padding: 14, backgroundColor: '#F8E9DF', borderRadius: 13 }, errorText: { color: '#A04335', fontSize: 13, lineHeight: 20 }, notice: { padding: 14, backgroundColor: '#FBE2BA', borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }, demo: { backgroundColor: '#F0E6CF', padding: 8, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 }, demoText: { color: '#6C684D', fontSize: 9, letterSpacing: .6 },
  brandLockup: { gap: 2 }, headerDescriptor: { color: palette.orange, fontSize: 10, letterSpacing: .7, fontWeight: '600' },
  brandDescriptor: { color: palette.orange, fontSize: 17, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontStyle: 'italic', marginTop: -8 },
  brandTagline: { color: green, fontSize: 14, textAlign: 'center' },
  auth: { flexGrow: 1, padding: 28, alignItems: 'center', justifyContent: 'center', maxWidth: 520, width: '100%', alignSelf: 'center', gap: 15 }, brandMark: { width: 86, height: 86, borderRadius: 28 }, wordmark: { fontSize: 35, fontWeight: '800', color: '#173C35', letterSpacing: -1.5 },
});
