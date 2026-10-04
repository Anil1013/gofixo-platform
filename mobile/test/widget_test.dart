import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('Gofixo app renders', (tester) async {
    await tester.pumpWidget(const RoleScreen(onLogin: _noop));
    await tester.pump();

    expect(find.text('Gofixo'), findsOneWidget);
    expect(find.text('Welcome to Gofixo'), findsOneWidget);
    expect(find.text('Continue as Customer'), findsOneWidget);
    expect(find.text('Continue as Partner'), findsOneWidget);
  });
}

void _noop() {}
