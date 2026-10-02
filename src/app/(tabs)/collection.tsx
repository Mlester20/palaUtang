import { View } from 'react-native';

import { EmptyState } from '@/components/empty-state';

export default function CollectionScreen() {
  return (
    <View className="flex-1 bg-slate-50 p-6 dark:bg-slate-950">
      <EmptyState
        icon="cash-outline"
        title="Nothing here yet"
        description="Your daily collections will show up here. Coming in the next phase."
      />
    </View>
  );
}
