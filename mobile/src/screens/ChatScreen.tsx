import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { ChannelBadge } from "@/components/ChannelBadge";
import { colors } from "@/theme/colors";
import { useInbox } from "@/state/InboxContext";
import type { Message } from "@/types";

export function ChatScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const chatId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { chats, hasMoreMessagesByChatId, loadMessages, loadOlderMessages, loadingMessagesByChatId, loadingOlderMessagesByChatId, messageErrorsByChatId, messagesByChatId, selectChat, sendMessage, user } = useInbox();
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList<Message>>(null);
  const loadedChatIdRef = useRef<string | null>(null);
  const didInitialScrollRef = useRef<string | null>(null);
  const userDraggedRef = useRef(false);
  const scrollMetricsRef = useRef({ contentHeight: 0, viewportHeight: 0, y: 0 });
  const chat = useMemo(() => chats.find((item) => item.id === chatId) ?? null, [chats, chatId]);
  const messages = chatId ? messagesByChatId[chatId] ?? [] : [];
  const isLoadingMessages = chatId ? Boolean(loadingMessagesByChatId[chatId]) : false;
  const isLoadingOlder = chatId ? Boolean(loadingOlderMessagesByChatId[chatId]) : false;
  const hasMore = chatId ? Boolean(hasMoreMessagesByChatId[chatId]) : false;
  const messageError = chatId ? messageErrorsByChatId[chatId] : null;
  const isOwnedByOtherAgent = Boolean(chat?.assignedTo && chat.assignedToId && chat.assignedToId !== user?.id && chat.attendantType === "agent");

  useEffect(() => {
    if (!chatId) return;
    selectChat(chatId);
    if (loadedChatIdRef.current !== chatId) {
      loadedChatIdRef.current = chatId;
      didInitialScrollRef.current = null;
      userDraggedRef.current = false;
      void loadMessages(chatId);
    }
  }, [chatId, loadMessages, selectChat]);

  useEffect(() => {
    if (!chatId || messages.length === 0 || didInitialScrollRef.current === chatId) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: false });
      didInitialScrollRef.current = chatId;
    }, 80);
    return () => clearTimeout(timer);
  }, [chatId, messages.length]);

  async function submit() {
    const content = draft.trim();
    if (!chat || !content) return;
    setDraft("");
    await sendMessage({ chatId: chat.id, content });
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }

  const renderMessage = useCallback(
    ({ item }: { item: Message }) => <MessageBubble message={item} contactName={chat?.contact.name || "Cliente"} />,
    [chat?.contact.name]
  );

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!chatId || isLoadingOlder || !hasMore || messages.length === 0) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const y = contentOffset?.y ?? 0;
    const contentHeight = contentSize?.height ?? 0;
    const viewportHeight = layoutMeasurement?.height ?? 0;
    scrollMetricsRef.current = { contentHeight, viewportHeight, y };

    const contentCanScroll = contentHeight > viewportHeight + 220;
    if (userDraggedRef.current && contentCanScroll && y < 48) {
      void loadOlderMessages(chatId);
    }
  }, [chatId, hasMore, isLoadingOlder, loadOlderMessages, messages.length]);

  if (!chat) {
    return (
      <AppShell>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Conversa nao encontrada.</Text>
          <Pressable style={styles.backButton} onPress={() => router.replace("/inbox")}>
            <Text style={styles.backButtonText}>Voltar ao inbox</Text>
          </Pressable>
        </View>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Pressable style={styles.iconButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{chat.contact.initials.slice(0, 2)}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.name} numberOfLines={1}>{chat.contact.name}</Text>
            <Text style={styles.meta} numberOfLines={1}>Mensagem recebida pelo canal conectado</Text>
          </View>
          <ChannelBadge channel={chat.contact.channel} compact />
        </View>

        {isOwnedByOtherAgent ? (
          <View style={styles.ownerBanner}>
            {chat.assignedAvatarUrl ? (
              <Image source={{ uri: chat.assignedAvatarUrl }} style={styles.ownerBannerAvatar} />
            ) : (
              <View style={styles.ownerBannerFallback}>
                <Ionicons name="person" size={15} color={colors.yellow} />
              </View>
            )}
            <View style={styles.ownerBannerText}>
              <Text style={styles.ownerBannerTitle}>Atendimento em andamento</Text>
              <Text style={styles.ownerBannerSubtitle} numberOfLines={1}>Esta conversa esta com {chat.assignedTo}</Text>
            </View>
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          contentContainerStyle={[styles.messages, messages.length === 0 && styles.messagesEmpty]}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          initialNumToRender={18}
          maxToRenderPerBatch={12}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          removeClippedSubviews={Platform.OS !== "web"}
          onScroll={handleScroll}
          onScrollBeginDrag={() => {
            userDraggedRef.current = true;
          }}
          scrollEventThrottle={120}
          updateCellsBatchingPeriod={80}
          windowSize={9}
          ListHeaderComponent={
            messages.length > 0 ? (
              <View style={styles.historyHeader}>
                {isLoadingOlder ? (
                  <>
                    <ActivityIndicator color={colors.emerald} size="small" />
                    <Text style={styles.historyHeaderText}>Carregando mensagens antigas...</Text>
                  </>
                ) : hasMore ? (
                  <Text style={styles.historyHeaderText}>Role para cima para carregar mensagens antigas</Text>
                ) : (
                  <Text style={styles.historyHeaderText}>Inicio do historico carregado</Text>
                )}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              {isLoadingMessages ? (
                <>
                  <ActivityIndicator color={colors.emerald} />
                  <Text style={styles.emptyMessagesText}>Carregando conversa...</Text>
                </>
              ) : messageError ? (
                <>
                  <Text style={styles.emptyMessagesTitle}>Nao foi possivel carregar a conversa.</Text>
                  <Text style={styles.emptyMessagesText}>{messageError}</Text>
                  <Pressable style={styles.retryButton} onPress={() => chatId && loadMessages(chatId)}>
                    <Text style={styles.retryButtonText}>Tentar novamente</Text>
                  </Pressable>
                </>
              ) : (
                <Text style={styles.emptyMessagesText}>Nenhuma mensagem carregada.</Text>
              )}
            </View>
          }
        />

        <View style={styles.composerWrap}>
          <View style={styles.composer}>
            <TextInput
              multiline
              placeholder="Digite uma mensagem..."
              placeholderTextColor={colors.textSubtle}
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
            />
            <Pressable
              accessibilityLabel="Enviar mensagem"
              style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
              onPress={submit}
            >
              <Ionicons name="send" size={18} color="#04130d" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </AppShell>
  );
}

const MessageBubble = memo(function MessageBubble({ message, contactName }: { message: Message; contactName: string }) {
  if (message.isSystem) {
    return (
      <View style={styles.systemBubble}>
        <Text style={styles.systemText}>{message.content}</Text>
        <Text style={styles.systemTime}>{formatMessageTime(message.createdAt)}</Text>
      </View>
    );
  }

  const isAgent = message.fromMe;
  const author = isAgent ? "Voce / agente" : contactName || "Cliente";

  return (
    <View style={[styles.messageRow, isAgent ? styles.messageRowMe : styles.messageRowContact]}>
      {!isAgent ? (
        <View style={styles.messageAvatar}>
          <Text style={styles.messageAvatarText}>C</Text>
        </View>
      ) : null}
      <View style={[styles.bubbleBlock, isAgent ? styles.bubbleBlockMe : styles.bubbleBlockContact]}>
        <Text style={[styles.author, isAgent ? styles.authorMe : styles.authorContact]}>{author}</Text>
        <View style={[styles.bubble, isAgent ? styles.bubbleMe : styles.bubbleContact]}>
          <Text style={[styles.bubbleText, isAgent ? styles.bubbleTextMe : styles.bubbleTextContact]}>
            {message.content}
          </Text>
          <View style={styles.bubbleFooter}>
            <Text style={[styles.bubbleTime, isAgent ? styles.bubbleTimeMe : styles.bubbleTimeContact]}>
              {formatMessageTime(message.createdAt)}
            </Text>
            {isAgent ? (
              <Ionicons
                name={message.status === "pending" ? "time-outline" : "checkmark-done"}
                size={13}
                color="rgba(4,19,13,0.58)"
              />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
});

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  root: {
    flex: 1
  },
  ownerBanner: {
    alignItems: "center",
    backgroundColor: "rgba(251,191,36,0.10)",
    borderBottomColor: "rgba(251,191,36,0.16)",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  ownerBannerAvatar: {
    borderRadius: 999,
    height: 34,
    width: 34
  },
  ownerBannerFallback: {
    alignItems: "center",
    backgroundColor: "rgba(251,191,36,0.12)",
    borderColor: "rgba(251,191,36,0.28)",
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  ownerBannerText: {
    flex: 1,
    minWidth: 0
  },
  ownerBannerTitle: {
    color: colors.yellow,
    fontSize: 12,
    fontWeight: "900"
  },
  ownerBannerSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2
  },
  header: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.emerald,
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  avatarText: {
    color: "#04130d",
    fontSize: 12,
    fontWeight: "900"
  },
  headerText: {
    flex: 1,
    minWidth: 0
  },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900"
  },
  meta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2
  },
  messages: {
    gap: 10,
    padding: 16,
    paddingBottom: 24
  },
  historyHeader: {
    alignItems: "center",
    gap: 8,
    paddingBottom: 6,
    paddingTop: 2
  },
  historyHeaderText: {
    color: colors.textSubtle,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center"
  },
  messagesEmpty: {
    flexGrow: 1
  },
  emptyMessages: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  emptyMessagesText: {
    color: colors.textMuted,
    marginTop: 10,
    textAlign: "center"
  },
  emptyMessagesTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center"
  },
  retryButton: {
    backgroundColor: colors.emerald,
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  retryButtonText: {
    color: "#04130d",
    fontWeight: "900"
  },
  messageRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
    width: "100%"
  },
  messageRowContact: {
    justifyContent: "flex-start"
  },
  messageRowMe: {
    justifyContent: "flex-end"
  },
  messageAvatar: {
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  messageAvatarText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900"
  },
  bubbleBlock: {
    maxWidth: "84%"
  },
  bubbleBlockContact: {
    alignItems: "flex-start"
  },
  bubbleBlockMe: {
    alignItems: "flex-end"
  },
  author: {
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 4,
    paddingHorizontal: 2
  },
  authorContact: {
    color: colors.textMuted
  },
  authorMe: {
    color: colors.emerald
  },
  bubble: {
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  bubbleContact: {
    backgroundColor: "#181b1f",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderTopLeftRadius: 4
  },
  bubbleMe: {
    backgroundColor: colors.emerald,
    borderTopRightRadius: 4
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20
  },
  bubbleTextContact: {
    color: colors.text
  },
  bubbleTextMe: {
    color: "#04130d",
    fontWeight: "700"
  },
  bubbleTime: {
    fontSize: 10,
    textAlign: "right"
  },
  bubbleFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "flex-end",
    marginTop: 6
  },
  bubbleTimeContact: {
    color: colors.textSubtle
  },
  bubbleTimeMe: {
    color: "rgba(4,19,13,0.62)"
  },
  systemBubble: {
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: "92%",
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  systemText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center"
  },
  systemTime: {
    color: colors.textSubtle,
    fontSize: 10,
    marginTop: 2,
    textAlign: "center"
  },
  composerWrap: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: 12
  },
  composer: {
    alignItems: "flex-end",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 10
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    maxHeight: 110,
    minHeight: 38,
    paddingHorizontal: 6,
    paddingVertical: 8
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: colors.emerald,
    borderRadius: 999,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  sendButtonDisabled: {
    opacity: 0.45
  },
  empty: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: 24
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  backButton: {
    backgroundColor: colors.emerald,
    borderRadius: 999,
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  backButtonText: {
    color: "#04130d",
    fontWeight: "900"
  }
});
