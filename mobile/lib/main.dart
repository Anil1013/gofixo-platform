import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:flutter_ota_kit/flutter_ota_kit.dart';
import 'api_service.dart';
import 'update_service.dart';
import 'ota_service.dart';
import 'app_info_page.dart';
import 'mobile_app_ui.dart';

const orange=Color(0xFF12B85F), navy=Color(0xFF172B4D), muted=Color(0xFF64748B);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await FlutterPatcher.init();
  runApp(const GofixoApp());
}

class GofixoApp extends StatelessWidget {
  const GofixoApp({super.key});
  @override Widget build(BuildContext c)=>MaterialApp(
    debugShowCheckedModeBanner:false,title:'Gofixo',
    theme:ThemeData(useMaterial3:true,colorScheme:ColorScheme.fromSeed(seedColor:orange),scaffoldBackgroundColor:const Color(0xFFF7F9FC)),
    home:const Gate(),
  );
}

class Gate extends StatefulWidget {
  const Gate({super.key});
  @override State<Gate> createState()=>_GateState();
}
class _GateState extends State<Gate>{
  Future<Session?>? f; bool updateChecked=false;
  @override void initState(){super.initState();f=ApiService.loadSession();}
  void refresh()=>setState(()=>f=ApiService.loadSession());
  @override Widget build(BuildContext c)=>FutureBuilder<Session?>(
    future:f,
    builder:(c,s){
      if(s.connectionState!=ConnectionState.done)return const Scaffold(body:Center(child:CircularProgressIndicator()));
      if(!updateChecked){
        updateChecked=true;
        WidgetsBinding.instance.addPostFrameCallback((_) async {
          final otaApplied=await OtaService.checkAndApply();
          if(!otaApplied&&c.mounted)await UpdateService.checkAndPrompt(c);
        });
      }
      final x=s.data;
      if(x==null)return RoleScreen(onLogin:refresh);
      return x.role=='provider'
        ?ReferenceProviderHome(session:x,onLogout:()async{await ApiService.clearSession();refresh();})
        :ReferenceCustomerHome(session:x,onLogout:()async{await ApiService.clearSession();refresh();});
    },
  );
}

class RoleScreen extends StatelessWidget {
  final VoidCallback onLogin;
  const RoleScreen({super.key, required this.onLogin});

  void _openAuth(BuildContext context, String role) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => Auth(role: role, onDone: onLogin),
      ),
    );
  }

  @override
  Widget build(BuildContext c) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4F7FB),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: const Text(
          'Gofixo',
          style: TextStyle(fontWeight: FontWeight.w900, color: navy),
        ),
        actions: [
          IconButton(
            onPressed: () => Navigator.push(
              c,
              MaterialPageRoute(builder: (_) => const AppInfoPage()),
            ),
            icon: const Icon(Icons.settings_outlined),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: const EdgeInsets.fromLTRB(18, 18, 10, 12),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF12B85F), Color(0xFF0A9F50)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(26),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Gofixo',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 30,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Rides & services, right at your doorstep.',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 14),
                          FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: Colors.white,
                              foregroundColor: orange,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 20,
                                vertical: 12,
                              ),
                            ),
                            onPressed: () => _openAuth(c, 'customer'),
                            child: const Text(
                              'Book a ride',
                              style: TextStyle(fontWeight: FontWeight.w800),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(
                      width: 115,
                      height: 115,
                      child: Icon(
                        Icons.directions_car_filled,
                        color: Colors.white,
                        size: 76,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 22),
              const Text(
                'How do you want to use Gofixo?',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  color: navy,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: _AccessCard(
                      icon: Icons.directions_car_rounded,
                      title: 'Ride & Services',
                      subtitle: 'Book rides, delivery & home services',
                      action: 'Continue',
                      onTap: () => _openAuth(c, 'customer'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _AccessCard(
                      icon: Icons.handshake_rounded,
                      title: 'Work & Earn',
                      subtitle: 'Drive, deliver or offer services',
                      action: 'Continue',
                      onTap: () => _openAuth(c, 'provider'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              const Text(
                'Popular home services',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  color: navy,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  'Electrician',
                  'Plumber',
                  'AC service',
                  'Cleaning',
                  'Painter',
                  'Carpenter',
                ]
                    .map(
                      (x) => Chip(
                        avatar: const Icon(
                          Icons.handyman_outlined,
                          size: 17,
                        ),
                        label: Text(x),
                      ),
                    )
                    .toList(),
              ),
              const SizedBox(height: 8),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 2),
                child: Text(
                  'New here? Choose an option above. You can log in or create your account on the next screen.',
                  style: TextStyle(
                    fontSize: 11,
                    color: muted,
                    height: 1.35,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AccessCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final String action;
  final VoidCallback onTap;

  const _AccessCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.action,
    required this.onTap,
  });

  @override
  Widget build(BuildContext c) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(22),
        child: Container(
          constraints: const BoxConstraints(minHeight: 172),
          padding: const EdgeInsets.fromLTRB(14, 16, 14, 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: const Color(0xFFE4E9F1)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x0F10213F),
                blurRadius: 12,
                offset: Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: Color(0xFFEFFFF5),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: orange, size: 26),
              ),
              const SizedBox(height: 12),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                  color: navy,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                subtitle,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 10,
                  height: 1.3,
                  color: muted,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                action,
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                  color: orange,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
class Auth extends StatefulWidget{
 final String role;final VoidCallback onDone;
 const Auth({super.key,required this.role,required this.onDone});
 @override State<Auth> createState()=>_AuthState();
}
class _AuthState extends State<Auth>{
 final form=GlobalKey<FormState>();final name=TextEditingController(),phone=TextEditingController(),pass=TextEditingController();
 String mode='login',type='bike';bool busy=false;String? error,msg;String appVersion='',buildNumber='';
 final Set<String> serviceCategories={};
 bool get provider=>widget.role=='provider';
 @override void initState(){super.initState();_loadAppVersion();}
 Future<void> _loadAppVersion()async{try{final info=await PackageInfo.fromPlatform();if(mounted)setState((){appVersion=info.version;buildNumber=info.buildNumber;});}catch(_){}}
 @override void dispose(){name.dispose();phone.dispose();pass.dispose();super.dispose();}
 Future<void> submit()async{
  if(!form.currentState!.validate())return;
  setState((){busy=true;error=null;msg=null;});
  try{
   if(mode=='register'){
    if(provider)await ApiService.registerProvider(name.text.trim(),phone.text.trim(),type,pass.text,serviceCategories:serviceCategories.toList());
    else await ApiService.registerCustomer(name.text.trim(),phone.text.trim(),pass.text);
    if(mounted)setState((){mode='login';msg='Account created. Please log in.';});
   }else if(mode=='forgot'){
    await ApiService.forgotPassword(widget.role,phone.text.trim());
    if(mounted)setState((){mode='login';msg='Reset request submitted.';});
   }else{
    await ApiService.login(widget.role,phone.text.trim(),pass.text);
    if(mounted){Navigator.pop(context);widget.onDone();}
   }
  }catch(e){if(mounted)setState(()=>error=e.toString().replaceFirst('Exception: ',''));}
  finally{if(mounted)setState(()=>busy=false);}
 }
 @override Widget build(BuildContext c){
  final reg=mode=='register',forgot=mode=='forgot';
  return Scaffold(appBar:AppBar(title:Text(provider?'Partner':'Customer')),body:Form(key:form,child:ListView(padding:const EdgeInsets.all(24),children:[
   Align(alignment:Alignment.topRight,child:Text(appVersion.isEmpty?'Version':'v$appVersion • Build $buildNumber',style:const TextStyle(fontSize:12,color:muted,fontWeight:FontWeight.w600))),
   const SizedBox(height:8),Text(forgot?'Forgot password':reg?'Create account':'Log in',style:const TextStyle(fontSize:28,fontWeight:FontWeight.w800,color:navy)),const SizedBox(height:22),
   if(reg)TextFormField(controller:name,decoration:const InputDecoration(labelText:'Name',border:OutlineInputBorder()),validator:(v)=>v==null||v.trim().isEmpty?'Enter your name':null),
   if(reg)const SizedBox(height:14),
   if(reg&&provider)DropdownButtonFormField<String>(value:type,decoration:const InputDecoration(labelText:'Partner type',border:OutlineInputBorder()),items:const[
    DropdownMenuItem(value:'bike',child:Text('Bike driver')),DropdownMenuItem(value:'auto',child:Text('Auto driver')),DropdownMenuItem(value:'car',child:Text('Car driver')),DropdownMenuItem(value:'general_worker',child:Text('Home helper')),DropdownMenuItem(value:'skilled_worker',child:Text('Skilled worker'))
   ],onChanged:(v)=>setState((){type=v??'bike';if(type=='bike'||type=='auto'||type=='car')serviceCategories.clear();})),
   if(reg&&provider&&(type=='general_worker'||type=='skilled_worker'))...
     [
       const Text('Home-service specialties',style:TextStyle(fontWeight:FontWeight.w800,color:navy)),
       const SizedBox(height:8),
       ...const [
         ('electrician','Electrician'),('plumber','Plumber'),('ac_service','AC Service'),
         ('cleaning','Cleaning'),('painter','Painter'),('carpenter','Carpenter'),
         ('appliance_repair','Appliance Repair'),('pest_control','Pest Control'),
         ('packers_movers','Packers & Movers'),('salon_beauty','Salon & Beauty'),
       ].map((item)=>CheckboxListTile(
         contentPadding:EdgeInsets.zero,dense:true,controlAffinity:ListTileControlAffinity.leading,
         value:serviceCategories.contains(item.$1),title:Text(item.$2),
         onChanged:(v)=>setState(()=>v==true?serviceCategories.add(item.$1):serviceCategories.remove(item.$1)),
       )),
       const SizedBox(height:6),
     ],
   if(reg&&provider)const SizedBox(height:14),
   TextFormField(controller:phone,keyboardType:TextInputType.phone,maxLength:10,decoration:const InputDecoration(labelText:'Phone number',prefixText:'+91 ',border:OutlineInputBorder()),validator:(v)=>RegExp(r'^\d{10}$').hasMatch(v?.trim()??'')?null:'Enter 10 digits'),
   if(!forgot)const SizedBox(height:14),
   if(!forgot)TextFormField(controller:pass,obscureText:true,decoration:const InputDecoration(labelText:'Password',border:OutlineInputBorder()),validator:(v)=>v==null||v.length<8?'Minimum 8 characters':null),
   if(error!=null)Padding(padding:const EdgeInsets.only(top:14),child:Text(error!,style:const TextStyle(color:Colors.red))),
   if(msg!=null)Padding(padding:const EdgeInsets.only(top:14),child:Text(msg!,style:const TextStyle(color:Colors.green))),
   const SizedBox(height:20),SizedBox(height:52,child:FilledButton(onPressed:busy?null:submit,child:busy?const CircularProgressIndicator():Text(forgot?'Request reset':reg?'Create account':'Log in'))),
   if(mode=='login')...[
    TextButton(onPressed:()=>setState(()=>mode='register'),child:const Text('New here? Create account')),
    TextButton(onPressed:()=>setState(()=>mode='forgot'),child:const Text('Forgot password?')),
   ]else TextButton(onPressed:()=>setState(()=>mode='login'),child:const Text('Back to login')),
  ])));
 }
}
