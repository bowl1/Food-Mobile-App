import { createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import React, { useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';

import { registerUser } from '@/services/api';
import { auth } from '@/services/firebase';

export function AuthScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!email || !password || (!isLogin && !username)) {
      Alert.alert('Notice', 'Please complete all required fields.');
      return;
    }

    try {
      setLoading(true);
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email.trim(), password.trim());
      } else {
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password.trim());
        if (credential.user) {
          await updateProfile(credential.user, { displayName: username.trim() });
          const token = await credential.user.getIdToken();
          if (token) {
            await registerUser(username.trim(), email.trim(), token);
          }
        }
      }
    } catch (error) {
      Alert.alert('Operation failed', String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={20}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>Fridge to Food</Text>
          {!isLogin ? (
            <TextInput
              style={styles.input}
              placeholder="Username"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              returnKeyType="next"
            />
          ) : null}
          <TextInput
            style={styles.input}
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            returnKeyType="next"
          />
          <TextInput
            style={styles.input}
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={submit}
          />

          <Pressable style={[styles.button, loading && styles.disabled]} disabled={loading} onPress={submit}>
            <Text style={styles.buttonText}>{loading ? 'Loading...' : isLogin ? 'Login' : 'Register'}</Text>
          </Pressable>

          <Pressable onPress={() => setIsLogin((value) => !value)}>
            <Text style={styles.switchText}>
              {isLogin ? "Don't have an account? Register" : 'Already have an account? Login'}
            </Text>
          </Pressable>
        </ScrollView>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2FAF5',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1D6F42',
    marginBottom: 8,
  },
  input: {
    borderColor: '#9CCBAF',
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    marginTop: 6,
    backgroundColor: '#1D6F42',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  disabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 16,
  },
  switchText: {
    color: '#2E8A54',
    textAlign: 'center',
    marginTop: 6,
  },
});
