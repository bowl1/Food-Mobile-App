import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, DEMO, Recipe } from './api';
import { SketchBorder } from './SketchPaper';
import { foodArt, palette } from './theme';

type ImageResult = { status: 'ready' | 'generating' | 'failed' | 'unavailable'; url?: string; thumbnail_url?: string };

export function RecipePhoto({ recipe, detail = false }: { recipe: Recipe; detail?: boolean }) {
  const retry = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pollRound, setPollRound] = useState(0);
  const pollingStarted = useRef(Date.now());
  const [pollExpired, setPollExpired] = useState(false);
  useEffect(() => {
    pollingStarted.current = Date.now();
    setPollExpired(false);
    const timer = setTimeout(() => setPollExpired(true), 180000);
    return () => clearTimeout(timer);
  }, [recipe.id, pollRound]);
  const image = useQuery({
    queryKey: ['chef-recipe-image', recipe.id],
    queryFn: async () => {
      const manualRetry = retry.current;
      retry.current = false;
      return api<ImageResult>(`/recipes/${recipe.id}/image${manualRetry ? '?retry=true' : ''}`, 'POST');
    },
    enabled: !DEMO && !!recipe.image_status && recipe.image_status !== 'none',
    retry: false,
    staleTime: 50 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchInterval: query => !pollExpired && query.state.data?.status === 'generating'
      ? Math.min(30000, 5000 * 2 ** Math.min(3, Math.floor((Date.now() - pollingStarted.current) / 30000))) : false,
  });
  const busy = image.isFetching || (!pollExpired && image.data?.status === 'generating');
  const url = detail ? image.data?.url : (image.data?.thumbnail_url ?? image.data?.url);
  const failed = !!image.error || image.data?.status === 'failed' || loadFailed || (pollExpired && image.data?.status === 'generating');
  return <View style={detail ? { gap: 8 } : { width: '100%', height: '100%' }}>
    <View style={{ width: '100%', height: detail ? 280 : '100%', backgroundColor: '#FFF6DF', overflow: 'hidden', borderRadius: detail ? 24 : 0 }}>
      {url && !loadFailed ? <Image source={{ uri: url }} accessibilityLabel={`AI generated image of ${recipe.recipe_name}`} resizeMode="cover" style={{ width: '100%', height: '100%' }} onError={() => setLoadFailed(true)} /> : <>
        <Image source={foodArt} accessible={false} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        <View style={{ position: 'absolute', right: 12, top: 14, backgroundColor: palette.cream, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 }}><Text style={{ color: palette.muted, fontSize: 9 }}>Kitchen illustration</Text></View>
        <View style={{ position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: '#FFFDF5F2', borderTopLeftRadius: 18, borderTopRightRadius: 12, borderBottomLeftRadius: 12, borderBottomRightRadius: 19, padding: 12, alignItems: 'center', gap: 7 }}><SketchBorder />
          {busy ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator color={palette.orange} /><Text style={{ color: palette.ink, fontSize: 12 }}>Creating your dish image…</Text></View> : <>
            <Text style={{ color: palette.ink, fontSize: 12, textAlign: 'center' }}>{DEMO ? 'Your dish image appears in live mode' : failed ? (image.error instanceof Error ? image.error.message : 'Your recipe is saved. Try its image again.') : 'Bring this recipe to life'}</Text>
            {!DEMO && <Pressable accessibilityRole="button" accessibilityLabel={failed ? 'Retry recipe image' : 'Generate recipe image'} onPress={event => { event.stopPropagation(); setLoadFailed(false); setPollRound(round => round + 1); retry.current = true; void image.refetch(); }} style={{ paddingVertical: 8, paddingHorizontal: 18, borderRadius: 12, backgroundColor: palette.orange }}><Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>{failed ? 'Retry image' : 'Generate image'}</Text></Pressable>}
          </>}
        </View>
      </>}
      {url && !loadFailed && <View style={{ position: 'absolute', bottom: 12, left: 12, backgroundColor: '#173C35E8', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 }}><Text style={{ color: palette.cream, fontSize: 10 }}>AI generated</Text></View>}
    </View>
    {detail && <Text style={{ fontSize: 11, color: palette.muted }}>{url ? 'AI illustration based on this recipe. Actual results may differ.' : 'Decorative kitchen illustration; your recipe image is not ready yet.'}</Text>}
  </View>;
}
