import { FontAwesome6, Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AppShell } from "@/components/AppShell";
import { colors } from "@/theme/colors";
import { useInbox } from "@/state/InboxContext";

export default function LoginScreen() {
  const { error, isLoading, login, user } = useInbox();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (user && !isLoading) router.replace("/inbox");
  }, [isLoading, user]);

  async function handleEnter() {
    try {
      await login({ email: email.trim(), password });
      router.replace("/inbox");
    } catch {
      // Error state is rendered by the inbox provider.
    }
  }

  return (
    <AppShell>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
        style={styles.keyboard}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.noise} />
          <View style={styles.brandBar}>
            <Text style={styles.brand}>Dialogy</Text>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={20} color={colors.text} />
              <Text style={styles.backText}>Voltar</Text>
            </Pressable>
          </View>

          <View style={styles.hero}>
            <Text style={styles.title}>Faca login na sua conta!</Text>
            <Text style={styles.subtitle}>Insira seu e-mail e senha cadastrados para entrar.</Text>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputShell}>
              <Ionicons name="mail-outline" size={22} color="#94a3b8" />
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="seu-email@exemplo.com"
                placeholderTextColor="rgba(226,232,240,0.48)"
                returnKeyType="next"
                style={styles.input}
                textContentType="emailAddress"
                value={email}
                onChangeText={setEmail}
              />
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Senha</Text>
            <View style={styles.inputShell}>
              <Ionicons name="lock-closed-outline" size={22} color="#94a3b8" />
              <TextInput
                autoCapitalize="none"
                placeholder="************"
                placeholderTextColor="rgba(226,232,240,0.48)"
                returnKeyType="done"
                secureTextEntry={!showPassword}
                style={styles.input}
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={handleEnter}
              />
              <Pressable onPress={() => setShowPassword((current) => !current)} hitSlop={12}>
                <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color="#94a3b8" />
              </Pressable>
            </View>
          </View>

          <View style={styles.formMeta}>
            <Pressable style={styles.remember} onPress={() => setRemember((current) => !current)}>
              <View style={[styles.checkbox, remember && styles.checkboxActive]}>
                {remember ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
              </View>
              <Text style={styles.metaText}>Lembrar de mim</Text>
            </Pressable>
            <Text style={styles.metaStrong}>Esqueceu a senha?</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={[styles.submit, (isLoading || !email.trim() || !password) && styles.submitDisabled]} onPress={handleEnter} disabled={isLoading || !email.trim() || !password}>
            {isLoading && !user ? <ActivityIndicator color="#030712" /> : <Text style={styles.submitText}>Entrar</Text>}
          </Pressable>

          <Text style={styles.signup}>
            Nao tem uma conta? <Text style={styles.signupStrong}>Cadastre-se gratuitamente</Text>
          </Text>

          <View style={styles.channelStrip}>
            <FontAwesome6 name="whatsapp" size={17} color="#25D366" />
            <FontAwesome6 name="instagram" size={17} color="#fb2d74" />
            <FontAwesome6 name="facebook-messenger" size={17} color="#3b82f6" />
            <Ionicons name="sparkles" size={18} color={colors.emerald} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  keyboard: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 34,
    paddingHorizontal: 24,
    paddingTop: 24
  },
  noise: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 999,
    height: 360,
    left: -40,
    opacity: 0.52,
    position: "absolute",
    top: 70,
    width: 360
  },
  brandBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 56
  },
  brand: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "900"
  },
  backButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12
  },
  backText: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: "800"
  },
  hero: {
    marginBottom: 44
  },
  title: {
    color: colors.text,
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 47
  },
  subtitle: {
    color: "rgba(255,255,255,0.48)",
    fontSize: 17,
    lineHeight: 24,
    marginTop: 22
  },
  fieldGroup: {
    marginBottom: 24
  },
  label: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 4,
    marginBottom: 14,
    marginLeft: 6,
    textTransform: "uppercase"
  },
  inputShell: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.055)",
    borderColor: "rgba(255,255,255,0.48)",
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    minHeight: 66,
    paddingHorizontal: 20
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: 20,
    minHeight: 62
  },
  formMeta: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 34,
    marginTop: 4
  },
  remember: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  checkbox: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 8,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  checkboxActive: {
    backgroundColor: "#169bff",
    borderColor: "#169bff"
  },
  metaText: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 16,
    fontWeight: "700"
  },
  metaStrong: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 16,
    fontWeight: "900"
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "800",
    marginBottom: 12,
    textAlign: "center"
  },
  submit: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 24,
    height: 68,
    justifyContent: "center"
  },
  submitDisabled: {
    opacity: 0.56
  },
  submitText: {
    color: "#030712",
    fontSize: 18,
    fontWeight: "900"
  },
  signup: {
    color: "rgba(255,255,255,0.46)",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 40,
    textAlign: "center"
  },
  signupStrong: {
    color: "#fff",
    fontWeight: "900"
  },
  channelStrip: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 20,
    marginTop: 44,
    paddingHorizontal: 22,
    paddingVertical: 13
  }
});
