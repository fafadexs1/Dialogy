import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { memo, useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { channelLabel } from "@/components/ChannelBadge";
import { colors } from "@/theme/colors";
import { useInbox } from "@/state/InboxContext";
import type { Channel, Chat, ChatStatus } from "@/types";

type FilterId = ChatStatus | "todos" | "meus";

const filters: Array<{ id: FilterId; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "todos", label: "Todos", icon: "albums-outline" },
  { id: "gerais", label: "Fila", icon: "people-outline" },
  { id: "meus", label: "Meus", icon: "person-circle-outline" },
  { id: "robo", label: "IA", icon: "sparkles-outline" }
];

const channelIcon: Record<Channel, keyof typeof FontAwesome6.glyphMap> = {
  whatsapp: "whatsapp",
  instagram: "instagram",
  messenger: "facebook-messenger",
  telegram: "telegram"
};

const channelColor: Record<Channel, string> = {
  whatsapp: "#25D366",
  instagram: "#fb2d74",
  messenger: "#3b82f6",
  telegram: "#38bdf8"
};

export function InboxScreen() {
  const { chats, error, isLoading, refresh, selectChat, switchWorkspace, user } = useInbox();
  const [activeFilter, setActiveFilter] = useState<FilterId>("todos");
  const [menuOpen, setMenuOpen] = useState(false);

  const myChats = useMemo(
    () => chats.filter((chat) => chat.assignedToId === user?.id),
    [chats, user?.id]
  );

  const stats = useMemo(() => ({
    queue: chats.filter((chat) => chat.status === "gerais").length,
    mine: myChats.length,
    ai: chats.filter((chat) => chat.isAiActive).length,
    unread: chats.reduce((sum, chat) => sum + chat.unreadCount, 0)
  }), [chats, myChats.length]);

  const channelStories = useMemo(() => {
    const map = new Map<Channel, { channel: Channel; total: number; unread: number }>();
    chats.forEach((chat) => {
      const current = map.get(chat.contact.channel) ?? { channel: chat.contact.channel, total: 0, unread: 0 };
      current.total += 1;
      current.unread += chat.unreadCount;
      map.set(chat.contact.channel, current);
    });
    return Array.from(map.values());
  }, [chats]);

  const visibleChats = useMemo(() => {
    if (activeFilter === "todos") return chats;
    if (activeFilter === "meus") return myChats;
    return chats.filter((chat) => chat.status === activeFilter);
  }, [activeFilter, chats, myChats]);

  const activeFilterMeta = filters.find((filter) => filter.id === activeFilter) ?? filters[0];

  const openChat = useCallback((chat: Chat) => {
    selectChat(chat.id);
    router.push({ pathname: "/chat/[id]", params: { id: chat.id } });
  }, [selectChat]);

  const renderChat = useCallback(
    ({ item }: { item: Chat }) => <ConversationCard chat={item} currentUserId={user?.id} onPress={() => openChat(item)} />,
    [openChat, user?.id]
  );

  return (
    <AppShell>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>Dialogy</Text>
          <Text style={styles.workspace} numberOfLines={1}>{user?.workspaceName ?? "Workspace"}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.roundButton} onPress={refresh}>
            <Ionicons name="refresh" size={18} color={colors.text} />
          </Pressable>
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarText}>{user?.initials || "D"}</Text>
          </View>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyRail}>
        <View style={styles.storyItem}>
          <View style={styles.meStory}>
            <Text style={styles.meStoryText}>{user?.initials || "D"}</Text>
          </View>
          <Text style={styles.storyText}>Voce</Text>
        </View>
        {channelStories.map((story) => (
          <View key={story.channel} style={styles.storyItem}>
            <View style={[styles.storyRing, { borderColor: channelColor[story.channel] }]}>
              <FontAwesome6 name={channelIcon[story.channel]} size={21} color={channelColor[story.channel]} />
              {story.unread > 0 ? (
                <View style={styles.storyBadge}>
                  <Text style={styles.storyBadgeText}>{story.unread > 9 ? "9+" : story.unread}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.storyText}>{channelLabel(story.channel)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>Atendimentos</Text>
          <Text style={styles.sectionSubtitle}>{activeFilterMeta.label} · {visibleChats.length} conversas</Text>
        </View>
        <Pressable style={styles.filterButton} onPress={() => setMenuOpen(true)}>
          <Ionicons name={activeFilterMeta.icon} size={16} color="#030712" />
          <Text style={styles.filterButtonText}>{activeFilterMeta.label}</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoading && chats.length === 0 ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.emerald} />
          <Text style={styles.loadingText}>Carregando atendimentos...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={visibleChats}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.emerald} />}
          renderItem={renderChat}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          removeClippedSubviews
          updateCellsBatchingPeriod={80}
          windowSize={7}
          ListEmptyComponent={<Text style={styles.emptyList}>Nenhuma conversa neste filtro.</Text>}
        />
      )}

      <FloatingCommandButton onPress={() => setMenuOpen(true)} unread={stats.unread} />

      <CommandMenu
        activeFilter={activeFilter}
        filters={filters}
        menuOpen={menuOpen}
        stats={stats}
        user={user}
        onClose={() => setMenuOpen(false)}
        onRefresh={refresh}
        onSelectFilter={(filter) => {
          setActiveFilter(filter);
          setMenuOpen(false);
        }}
        onSwitchWorkspace={switchWorkspace}
      />
    </AppShell>
  );
}

function FloatingCommandButton({ onPress, unread }: { onPress: () => void; unread: number }) {
  return (
    <Pressable style={styles.fab} onPress={onPress}>
      <Ionicons name="grid" size={22} color="#030712" />
      {unread > 0 ? (
        <View style={styles.fabBadge}>
          <Text style={styles.fabBadgeText}>{unread > 99 ? "99+" : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function CommandMenu({
  activeFilter,
  filters: filterOptions,
  menuOpen,
  stats,
  user,
  onClose,
  onRefresh,
  onSelectFilter,
  onSwitchWorkspace,
}: {
  activeFilter: FilterId;
  filters: Array<{ id: FilterId; label: string; icon: keyof typeof Ionicons.glyphMap }>;
  menuOpen: boolean;
  stats: { queue: number; mine: number; ai: number; unread: number };
  user: ReturnType<typeof useInbox>["user"];
  onClose: () => void;
  onRefresh: () => void;
  onSelectFilter: (filter: FilterId) => void;
  onSwitchWorkspace: (workspaceId: string) => void;
}) {
  return (
    <Modal animationType="fade" transparent visible={menuOpen} onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.commandSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <Text style={styles.sheetTitle}>Central de atendimento</Text>
              <Text style={styles.sheetSubtitle}>{user?.name ?? "Usuario"} · Online</Text>
            </View>
            <Pressable style={styles.sheetClose} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.sheetStats}>
            <SheetStat label="Fila" value={stats.queue} icon="people-outline" />
            <SheetStat label="Meus" value={stats.mine} icon="person-circle-outline" />
            <SheetStat label="IA" value={stats.ai} icon="sparkles-outline" />
            <SheetStat label="Novas" value={stats.unread} icon="mail-unread-outline" />
          </View>

          <Text style={styles.menuLabel}>Filtros</Text>
          <View style={styles.menuGrid}>
            {filterOptions.map((filter) => {
              const active = filter.id === activeFilter;
              return (
                <Pressable key={filter.id} style={[styles.menuOption, active && styles.menuOptionActive]} onPress={() => onSelectFilter(filter.id)}>
                  <Ionicons name={filter.icon} size={19} color={active ? "#030712" : colors.text} />
                  <Text style={[styles.menuOptionText, active && styles.menuOptionTextActive]}>{filter.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {user?.workspaces && user.workspaces.length > 1 ? (
            <>
              <Text style={styles.menuLabel}>Workspaces</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workspaceMenuRail}>
                {user.workspaces.map((workspace) => {
                  const active = workspace.id === user.workspaceId;
                  return (
                    <Pressable
                      key={workspace.id}
                      style={[styles.workspaceMenuPill, active && styles.workspaceMenuPillActive]}
                      onPress={() => {
                        onSwitchWorkspace(workspace.id);
                        onClose();
                      }}
                    >
                      <Text style={[styles.workspaceMenuText, active && styles.workspaceMenuTextActive]} numberOfLines={1}>{workspace.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          <Pressable style={styles.syncButton} onPress={onRefresh}>
            <Ionicons name="sync" size={17} color="#030712" />
            <Text style={styles.syncButtonText}>Sincronizar agora</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetStat({ label, value, icon }: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.sheetStat}>
      <Ionicons name={icon} size={16} color={colors.emerald} />
      <Text style={styles.sheetStatValue}>{value}</Text>
      <Text style={styles.sheetStatLabel}>{label}</Text>
    </View>
  );
}

const ConversationCard = memo(function ConversationCard({ chat, currentUserId, onPress }: { chat: Chat; currentUserId?: string; onPress: () => void }) {
  const isMine = Boolean(currentUserId && chat.assignedToId === currentUserId);
  const isOtherAgent = Boolean(chat.assignedTo && chat.assignedToId && chat.assignedToId !== currentUserId && chat.attendantType === "agent");
  const ownerLabel = isMine
    ? "Seu atendimento"
    : isOtherAgent
      ? `Com ${chat.assignedTo}`
      : chat.attendantType === "ai"
        ? chat.assignedTo || "IA conduzindo"
        : "Disponivel na fila";

  return (
    <Pressable style={[styles.card, chat.unreadCount > 0 && styles.cardUnread]} onPress={onPress}>
      <View style={styles.avatarStack}>
        {chat.contact.avatarUrl ? (
          <Image source={{ uri: chat.contact.avatarUrl }} style={styles.contactImage} />
        ) : (
          <View style={styles.contactAvatar}>
            <Text style={styles.contactAvatarText}>{chat.contact.initials.slice(0, 2)}</Text>
          </View>
        )}
        <View style={[styles.channelBubble, { backgroundColor: channelColor[chat.contact.channel] }]}>
          <FontAwesome6 name={channelIcon[chat.contact.channel]} size={10} color="#03140e" />
        </View>
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTop}>
          <Text style={styles.contactName} numberOfLines={1}>{chat.contact.name}</Text>
          <Text style={styles.timeText}>{formatShortTime(chat.lastMessageAt)}</Text>
        </View>
        <Text style={styles.messagePreview} numberOfLines={2}>{chat.lastMessage}</Text>
        <View style={styles.ownerRow}>
          <View style={[styles.ownerPill, isOtherAgent && styles.ownerPillOther, isMine && styles.ownerPillMine]}>
            {isOtherAgent && chat.assignedAvatarUrl ? (
              <Image source={{ uri: chat.assignedAvatarUrl }} style={styles.ownerPhoto} />
            ) : (
              <Ionicons
                name={chat.attendantType === "ai" ? "sparkles" : chat.attendantType === "agent" ? "person" : "radio-button-on"}
                size={12}
                color={isOtherAgent ? "#fbbf24" : isMine ? colors.emerald : colors.textMuted}
              />
            )}
            <Text style={[styles.ownerText, isOtherAgent && styles.ownerTextOther, isMine && styles.ownerTextMine]} numberOfLines={1}>{ownerLabel}</Text>
          </View>
          {chat.teamName ? <Text style={styles.teamTag} numberOfLines={1}>{chat.teamName}</Text> : null}
        </View>
      </View>

      {chat.unreadCount > 0 ? (
        <View style={styles.unreadBubble}>
          <Text style={styles.unreadText}>{chat.unreadCount > 99 ? "99+" : chat.unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
});

function formatShortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "agora";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 10
  },
  brand: {
    color: colors.text,
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0
  },
  workspace: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 2
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  roundButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  userAvatar: {
    alignItems: "center",
    backgroundColor: "#20E401",
    borderRadius: 999,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  userAvatarText: {
    color: "#04130d",
    fontSize: 13,
    fontWeight: "900"
  },
  storyRail: {
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 22
  },
  storyItem: {
    alignItems: "center",
    width: 72
  },
  meStory: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.20)",
    borderRadius: 999,
    borderWidth: 2,
    height: 62,
    justifyContent: "center",
    width: 62
  },
  meStoryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  storyRing: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderRadius: 999,
    borderWidth: 2,
    height: 62,
    justifyContent: "center",
    position: "relative",
    width: 62
  },
  storyBadge: {
    alignItems: "center",
    backgroundColor: "#20E401",
    borderColor: colors.bg,
    borderRadius: 999,
    borderWidth: 2,
    bottom: -2,
    height: 22,
    justifyContent: "center",
    minWidth: 22,
    position: "absolute",
    right: -6
  },
  storyBadgeText: {
    color: "#03140e",
    fontSize: 10,
    fontWeight: "900"
  },
  storyText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 6,
    textAlign: "center"
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 24
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900"
  },
  sectionSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 999,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  filterButtonText: {
    color: "#030712",
    fontSize: 12,
    fontWeight: "900"
  },
  error: {
    color: colors.danger,
    paddingHorizontal: 20,
    paddingTop: 12
  },
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  loadingText: {
    color: colors.textMuted,
    marginTop: 10
  },
  list: {
    gap: 12,
    padding: 20,
    paddingBottom: 120
  },
  emptyList: {
    color: colors.textMuted,
    paddingVertical: 34,
    textAlign: "center"
  },
  fab: {
    alignItems: "center",
    backgroundColor: "#20E401",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    borderWidth: 1,
    bottom: 28,
    height: 62,
    justifyContent: "center",
    position: "absolute",
    right: 22,
    shadowColor: "#20E401",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    width: 62
  },
  fabBadge: {
    alignItems: "center",
    backgroundColor: "#ff2f5f",
    borderColor: colors.bg,
    borderRadius: 999,
    borderWidth: 2,
    minWidth: 24,
    paddingHorizontal: 5,
    position: "absolute",
    right: -4,
    top: -4
  },
  fabBadgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900"
  },
  modalBackdrop: {
    backgroundColor: "rgba(0,0,0,0.54)",
    flex: 1,
    justifyContent: "flex-end"
  },
  commandSheet: {
    backgroundColor: "#090d0b",
    borderColor: colors.border,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    borderWidth: 1,
    paddingBottom: 26,
    paddingHorizontal: 20,
    paddingTop: 10
  },
  sheetHandle: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    height: 4,
    marginBottom: 18,
    width: 44
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900"
  },
  sheetSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4
  },
  sheetClose: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 999,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  sheetStats: {
    flexDirection: "row",
    gap: 8,
    marginTop: 18
  },
  sheetStat: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 12
  },
  sheetStatValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 5
  },
  sheetStatLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2
  },
  menuLabel: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 20,
    textTransform: "uppercase"
  },
  menuGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  menuOption: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  menuOptionActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff"
  },
  menuOptionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900"
  },
  menuOptionTextActive: {
    color: "#030712"
  },
  workspaceMenuRail: {
    gap: 8
  },
  workspaceMenuPill: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 190,
    paddingHorizontal: 13,
    paddingVertical: 9
  },
  workspaceMenuPillActive: {
    backgroundColor: "rgba(32,228,1,0.13)",
    borderColor: "rgba(32,228,1,0.34)"
  },
  workspaceMenuText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800"
  },
  workspaceMenuTextActive: {
    color: colors.emerald
  },
  syncButton: {
    alignItems: "center",
    backgroundColor: "#20E401",
    borderRadius: 18,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 20,
    paddingVertical: 14
  },
  syncButtonText: {
    color: "#030712",
    fontSize: 14,
    fontWeight: "900"
  },
  card: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.052)",
    borderColor: colors.border,
    borderRadius: 26,
    borderWidth: 1,
    flexDirection: "row",
    gap: 13,
    minHeight: 104,
    padding: 14
  },
  cardUnread: {
    backgroundColor: "rgba(32,228,1,0.08)",
    borderColor: "rgba(32,228,1,0.26)"
  },
  avatarStack: {
    position: "relative"
  },
  contactImage: {
    borderRadius: 999,
    height: 58,
    width: 58
  },
  contactAvatar: {
    alignItems: "center",
    backgroundColor: "#17201c",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 58,
    justifyContent: "center",
    width: 58
  },
  contactAvatarText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900"
  },
  channelBubble: {
    alignItems: "center",
    borderColor: colors.bgPanel,
    borderRadius: 999,
    borderWidth: 2,
    bottom: -2,
    height: 24,
    justifyContent: "center",
    position: "absolute",
    right: -5,
    width: 24
  },
  cardBody: {
    flex: 1,
    minWidth: 0
  },
  cardTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  contactName: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: "900"
  },
  timeText: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: "800"
  },
  messagePreview: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6
  },
  ownerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 10
  },
  ownerPill: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    maxWidth: "70%",
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  ownerPillMine: {
    backgroundColor: "rgba(32,228,1,0.12)"
  },
  ownerPillOther: {
    backgroundColor: "rgba(251,191,36,0.12)"
  },
  ownerPhoto: {
    borderRadius: 999,
    height: 18,
    width: 18
  },
  ownerText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "900"
  },
  ownerTextMine: {
    color: colors.emerald
  },
  ownerTextOther: {
    color: colors.yellow
  },
  teamTag: {
    color: colors.textSubtle,
    flex: 1,
    fontSize: 10,
    fontWeight: "800"
  },
  unreadBubble: {
    alignItems: "center",
    backgroundColor: "#20E401",
    borderRadius: 999,
    height: 27,
    justifyContent: "center",
    minWidth: 27,
    paddingHorizontal: 7
  },
  unreadText: {
    color: "#03140e",
    fontSize: 11,
    fontWeight: "900"
  }
});
