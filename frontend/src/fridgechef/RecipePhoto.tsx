import React, { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, DEMO, Recipe } from './api';

type ImageResult = { status: 'ready' | 'generating' | 'failed' | 'unavailable'; url?: string };

export function RecipePhoto({ recipe, detail = false }: { recipe: Recipe; detail?: boolean }) {
  const retry = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
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
    refetchInterval: query => query.state.data?.status === 'generating' ? 5000 : false,
  });
  const busy = image.isFetching || image.data?.status === 'generating';
  const url = image.data?.url;
  const failed = !!image.error || image.data?.status === 'failed' || loadFailed;
  return <View style={detail ? { gap: 6 } : { width: '100%', height: '100%' }}>
    <View style={{ width: '100%', height: detail ? 240 : '100%', backgroundColor: '#E8EEDB', overflow: 'hidden', borderRadius: detail ? 18 : 0, alignItems: 'center', justifyContent: 'center' }}>
      {url && !loadFailed ? <Image source={{ uri: url }} accessibilityLabel={`AI generated image of ${recipe.recipe_name}`} resizeMode="cover" style={{ width: '100%', height: '100%' }} onError={() => setLoadFailed(true)} /> : <View style={{ alignItems: 'center', gap: 8, padding: 15 }}>
        {busy ? <><ActivityIndicator color="#285A43" /><Text style={{ color: '#285A43', fontSize: 12 }}>Creating your dish image…</Text></> : <>
          <Text style={{ color: '#285A43', fontSize: 12 }}>{DEMO ? 'Images are available in live mode' : failed ? 'Image unavailable. Your recipe is saved.' : 'Create an AI image for this recipe'}</Text>
          {!DEMO && <Pressable accessibilityRole="button" accessibilityLabel={failed ? 'Retry recipe image' : 'Generate recipe image'} onPress={event => { event.stopPropagation(); setLoadFailed(false); retry.current = true; void image.refetch(); }} style={{ padding: 10 }}><Text style={{ color: '#285A43', fontWeight: '700' }}>{failed ? 'Retry image' : 'Generate image'}</Text></Pressable>}
        </>}
      </View>}
      {url && !loadFailed && <View style={{ position: 'absolute', bottom: 10, left: 12, backgroundColor: 'rgba(0,0,0,.6)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8 }}><Text style={{ color: '#fff', fontSize: 10 }}>AI generated</Text></View>}
    </View>
    {detail && <Text style={{ fontSize: 11, color: '#798274' }}>AI illustration based on this recipe. Actual results may differ.</Text>}
  </View>;
}
