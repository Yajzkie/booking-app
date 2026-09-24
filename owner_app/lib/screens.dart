import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'main.dart';

class Booking {
  final int id;
  final String customerName;
  final String? customerEmail;
  final String? customerPhone;
  final String serviceName;
  final String date;
  final String session;
  final String status;

  Booking.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        customerName = j['customer_name'] ?? 'Unknown',
        customerEmail = j['customer_email'],
        customerPhone = j['customer_phone'],
        serviceName = (j['services'] is Map)
            ? (j['services'] as Map)['name']?.toString() ?? 'Service'
            : 'Service',
        date = (j['date'] ?? '').toString(),
        session = (j['session'] ?? '').toString(),
        status = j['status'] ?? 'pending';

  String get sessionLabel =>
      session == 'morning' ? 'Morning' : session == 'afternoon' ? 'Afternoon' : session;
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  String? _error;

  Future<void> _login() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await db.auth.signInWithPassword(
        email: _email.text.trim(),
        password: _password.text,
      );
    } on AuthException catch (e) {
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Booking Owner',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 24),
                TextField(
                  controller: _email,
                  decoration: const InputDecoration(labelText: 'Email'),
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _password,
                  decoration: const InputDecoration(labelText: 'Password'),
                  obscureText: true,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: TextStyle(color: Colors.red)),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _loading ? null : _login,
                  child: _loading
                      ? const CircularProgressIndicator()
                      : const Text('Sign in'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _tab = 0;
  late RealtimeChannel _channel;
  final _bookingsKey = GlobalKey<_BookingsTabState>();
  final _servicesKey = GlobalKey<_ServicesTabState>();

  @override
  void initState() {
    super.initState();
    // Booking changes (new or status flip) arrive here in realtime.
    _channel = db
        .channel('bookings-feed')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'bookings',
          callback: (_) {
            _bookingsKey.currentState?.reload();
            _servicesKey.currentState?.reload();
          },
        )
        .subscribe();
  }

  @override
  void dispose() {
    db.removeChannel(_channel);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_tab == 0 ? 'Bookings' : 'Services')),
      body: _tab == 0
          ? BookingsTab(key: _bookingsKey)
          : ServicesTab(key: _servicesKey),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.event), label: 'Bookings'),
          NavigationDestination(icon: Icon(Icons.build), label: 'Services'),
        ],
        onDestinationSelected: (i) => setState(() => _tab = i),
      ),
    );
  }
}

class BookingsTab extends StatefulWidget {
  const BookingsTab({super.key});

  @override
  State<BookingsTab> createState() => _BookingsTabState();
}

class _BookingsTabState extends State<BookingsTab> {
  List<Booking> _bookings = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> reload() async {
    await _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await db
          .from('bookings')
          .select('id, customer_name, customer_email, customer_phone, '
              'date, session, status, services(name)')
          .order('date', ascending: true);
      setState(() {
        _bookings = (res as List)
            .map((j) => Booking.fromJson(j))
            .toList()
          ..sort((a, b) {
            final c = a.date.compareTo(b.date);
            return c != 0
                ? c
                : a.session == 'morning'
                    ? (b.session == 'morning' ? 0 : 1)
                    : (b.session == 'afternoon' ? 0 : -1);
          });
        _loading = false;
        _error = null;
      });
    } on PostgrestException catch (e) {
      setState(() {
        _error = e.message;
        _loading = false;
      });
    }
  }

  int get _pendingCount =>
      _bookings.where((b) => b.status == 'pending').length;

  Future<void> _setStatus(Booking booking, String status) async {
    try {
      await db
          .from('bookings')
          .update({'status': status})
          .eq('id', booking.id);
    } on PostgrestException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: ${e.message}')),
        );
      }
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child:
              Text('Could not load bookings:\n$_error', textAlign: TextAlign.center),
        ),
      );
    }
    if (_bookings.isEmpty) {
      return const Center(child: Text('No bookings yet.'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          if (_pendingCount > 0)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text('$_pendingCount pending',
                  style: TextStyle(
                      color: Colors.orange.shade800, fontWeight: FontWeight.w600)),
            ),
          for (final b in _bookings) _BookingCard(booking: b, onAction: _setStatus),
        ],
      ),
    );
  }
}

class _BookingCard extends StatelessWidget {
  const _BookingCard({required this.booking, required this.onAction});

  final Booking booking;
  final Future<void> Function(Booking, String) onAction;

  Color get _statusColor => switch (booking.status) {
        'confirmed' => Colors.green,
        'cancelled' => Colors.grey,
        _ => Colors.orange,
      };

  @override
  Widget build(BuildContext context) {
    final date = DateTime.tryParse(booking.date);
    final label = date == null
        ? booking.date
        : '${date.month}/${date.day}/${date.year}';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        title: Text('${booking.customerName} — ${booking.serviceName}'),
        subtitle: Text('$label — ${booking.sessionLabel}\n'
            'Status: ${booking.status.toUpperCase()}'),
        trailing: Icon(Icons.circle, size: 14, color: _statusColor),
        onTap: () => showModalBottomSheet(
          context: context,
          builder: (context) => _BookingDetail(booking: booking, onAction: onAction),
        ),
      ),
    );
  }
}

class _BookingDetail extends StatelessWidget {
  const _BookingDetail({required this.booking, required this.onAction});

  final Booking booking;
  final Future<void> Function(Booking, String) onAction;

  @override
  Widget build(BuildContext context) {
    final canAct = booking.status == 'pending';
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${booking.customerName} · ${booking.serviceName}',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            Text('${booking.date} — ${booking.sessionLabel}'),
            if (booking.customerEmail != null) Text(booking.customerEmail!),
            if (booking.customerPhone != null) Text(booking.customerPhone!),
            const SizedBox(height: 24),
            if (canAct)
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: () =>
                        _action(context, 'cancelled'),
                    child: const Text('Cancel booking'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: () => _action(context, 'confirmed'),
                    child: const Text('Confirm'),
                  ),
                ],
              )
            else
              Text(booking.status.toUpperCase(),
                  style: TextStyle(color: Colors.grey[600])),
          ],
        ),
      ),
    );
  }

  Future<void> _action(BuildContext context, String status) async {
    Navigator.pop(context);
    await onAction(booking, status);
  }
}

class ServicesTab extends StatefulWidget {
  const ServicesTab({super.key});

  @override
  State<ServicesTab> createState() => _ServicesTabState();
}

class _ServicesTabState extends State<ServicesTab> {
  List<Map<String, dynamic>> _services = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> reload() async {
    await _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final res = await db.from('services').select('*').order('name');
      setState(() {
        _loading = false;
        _error = null;
        _services = (res as List).cast<Map<String, dynamic>>();
      });
    } on PostgrestException catch (e) {
      setState(() {
        _loading = false;
        _error = e.message;
      });
    }
  }

  Future<void> _saveService(Map<String, dynamic> fields, {int? id}) async {
    try {
      if (id == null) {
        await db.from('services').insert(fields);
      } else {
        await db.from('services').update(fields).eq('id', id);
      }
    } on PostgrestException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Failed: ${e.message}')));
      }
      return;
    }
    await _load();
  }

  Future<void> _deleteService(int id) async {
    await db.from('services').delete().eq('id', id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showEditor(context),
        tooltip: 'Add service',
        child: const Icon(Icons.add),
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return Center(child: Text(_error!));
    if (_services.isEmpty) {
      return const Center(child: Text('No services yet. Tap + to add one.'));
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(12),
        children: [
          for (final s in _services)
            ListTile(
              title: Text(s['name'].toString()),
              subtitle: Text(s['description']?.toString() ?? ''),
              trailing: Text('\$${s['price']} · ${s['duration_minutes']}min',
                  style: TextStyle(
                      color: Theme.of(context).colorScheme.primary)),
              onTap: () => _showEditor(context, service: s),
              onLongPress: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text('Delete service?'),
                    content: Text('"${s['name']}" will be gone.'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(context, false),
                          child: const Text('Keep')),
                      TextButton(
                          onPressed: () => Navigator.pop(context, true),
                          child: const Text('Delete')),
                    ],
                  ),
                );
                if (ok == true) await _deleteService(s['id'] as int);
              },
            ),
        ],
      ),
    );
  }

  void _showEditor(BuildContext context, {Map<String, dynamic>? service}) {
    final isEdit = service != null;
    final name = TextEditingController(text: service?['name']?.toString() ?? '');
    final desc = TextEditingController(
        text: service?['description']?.toString() ?? '');
    final price = TextEditingController(
        text: service?['price']?.toString() ?? '');
    final dur = TextEditingController(
        text: service?['duration_minutes']?.toString() ?? '30');

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding:
            EdgeInsets.only(left: 24, right: 24, bottom: MediaQuery.of(context).viewInsets.bottom + 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 24),
            Text(isEdit ? 'Edit service' : 'New service',
                style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 16),
            TextField(controller: name,
                decoration: const InputDecoration(labelText: 'Name')),
            TextField(controller: desc,
                decoration: const InputDecoration(labelText: 'Description')),
            Row(
              children: [
                Expanded(
                  child: TextField(
                      controller: price,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      decoration: const InputDecoration(labelText: 'Price \$')),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: TextField(
                      controller: dur,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Minutes')),
                ),
              ],
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: () async {
                final fields = <String, Object?>{
                  'name': name.text.trim(),
                  'description': desc.text.trim().isEmpty ? null : desc.text.trim(),
                  'price': double.tryParse(price.text) ?? 0,
                  'duration_minutes': int.tryParse(dur.text) ?? 30,
                };
                Navigator.pop(context);
                await _saveService(fields, id: service?['id'] as int?);
              },
              child: const Text('Save'),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}