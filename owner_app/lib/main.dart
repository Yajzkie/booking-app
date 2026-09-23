import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'screens.dart';

// Paste your Supabase project URL and anon key (Project Settings -> API).
const supabaseUrl = 'https://bkbtchmlhcdtspttmfoa.supabase.co';
const supabaseAnonKey = 'sb_publishable_hn6oUYHW4xHsCiLPvOC0rg_LD6fwLQo';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(
      url: supabaseUrl, publishableKey: supabaseAnonKey);
  runApp(const BookingOwnerApp());
}

class BookingOwnerApp extends StatelessWidget {
  const BookingOwnerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Booking Owner',
      theme: ThemeData(colorSchemeSeed: Colors.indigo, useMaterial3: true),
      home: const AuthGate(),
    );
  }
}

class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    final session = Supabase.instance.client.auth.currentSession;
    if (session != null) {
      return StreamBuilder<AuthState>(
        stream: Supabase.instance.client.auth.onAuthStateChange,
        builder: (context, snap) {
          if (snap.data?.session != null) return const HomeScreen();
          return const LoginScreen();
        },
      );
    }
    return const LoginScreen();
  }
}

SupabaseClient get db => Supabase.instance.client;