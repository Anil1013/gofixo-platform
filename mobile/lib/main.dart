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

  static const _heroImage =
      'https://images.unsplash.com/photo-1647539989255-ac2634cc8c92?auto=format&fit=crop&w=1400&q=82';
  static const _customerImage =
      'https://images.unsplash.com/photo-1662499840736-0178ce197a70?auto=format&fit=crop&w=1200&q=82';
  static const _partnerImage =
      'https://images.unsplash.com/photo-1647539989255-ac2634cc8c92?auto=format&fit=crop&w=1200&q=82';
  static const _serviceImage =
      'https://images.unsplash.com/photo-1747110594869-789610507597?auto=format&fit=crop&w=1200&q=82';

  void _openAuth(BuildContext context, String role) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => Auth(role: role, onDone: onLogin)),
    );
  }

  @override
  Widget build(BuildContext c) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
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
            icon: const Icon(Icons.settings_outlined, color: navy),
          ),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 30),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _PhotoHero(
                imageUrl: _heroImage,
                title: 'Move. Live. Get things done.',
                subtitle: 'Rides and trusted home services, right when you need them.',
                button: 'Book a ride',
                onTap: () => _openAuth(c, 'customer'),
              ),
              const SizedBox(height: 24),
              const Text(
                'What do you need today?',
                style: TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  color: navy,
                ),
              ),
              const SizedBox(height: 5),
              const Text(
                'Choose your Gofixo experience',
                style: TextStyle(fontSize: 13, color: muted),
              ),
              const SizedBox(height: 12),
              _RolePhotoCard(
                imageUrl: _customerImage,
                title: 'Book rides & services',
                subtitle: 'Bike, Auto, Car and reliable home services.',
                button: 'Continue as Customer',
                icon: Icons.directions_car_rounded,
                onTap: () => _openAuth(c, 'customer'),
              ),
              const SizedBox(height: 12),
              _RolePhotoCard(
                imageUrl: _partnerImage,
                title: 'Earn with Gofixo',
                subtitle: 'Drive, deliver or offer your professional services.',
                button: 'Continue as Partner',
                icon: Icons.handshake_rounded,
                onTap: () => _openAuth(c, 'provider'),
              ),
              const SizedBox(height: 24),
              const Text(
                'Home services',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                  color: navy,
                ),
              ),
              const SizedBox(height: 10),
              _ServicePhotoStrip(
                imageUrl: _serviceImage,
                onTap: () => _openAuth(c, 'customer'),
              ),
              const SizedBox(height: 12),
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
                        avatar: const Icon(Icons.handyman_outlined, size: 17),
                        label: Text(x),
                      ),
                    )
                    .toList(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PhotoHero extends StatelessWidget {
  final String imageUrl;
  final String title;
  final String subtitle;
  final String button;
  final VoidCallback onTap;

  const _PhotoHero({
    required this.imageUrl,
    required this.title,
    required this.subtitle,
    required this.button,
    required this.onTap,
  });

  @override
  Widget build(BuildContext c) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(26),
      child: SizedBox(
        height: 245,
        width: double.infinity,
        child: Stack(
          fit: StackFit.expand,
          children: [
            _NetworkPhoto(imageUrl: imageUrl, icon: Icons.directions_car_filled),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Color(0xDD061B2E), Color(0x5212B85F), Color(0xAA061B2E)],
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  const Text(
                    'GOFIXO',
                    style: TextStyle(
                      color: Color(0xFF7CFFB1),
                      fontSize: 12,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 2,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      height: 1.05,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    subtitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 13,
                      height: 1.3,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 14),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: orange,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                    ),
                    onPressed: onTap,
                    child: Text(button, style: const TextStyle(fontWeight: FontWeight.w900)),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RolePhotoCard extends StatelessWidget {
  final String imageUrl;
  final String title;
  final String subtitle;
  final String button;
  final IconData icon;
  final VoidCallback onTap;

  const _RolePhotoCard({
    required this.imageUrl,
    required this.title,
    required this.subtitle,
    required this.button,
    required this.icon,
    required this.onTap,
  });

  @override
  Widget build(BuildContext c) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(22),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 166,
          child: Stack(
            fit: StackFit.expand,
            children: [
              _NetworkPhoto(imageUrl: imageUrl, icon: icon),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xF0091A2D), Color(0x90102B3F), Color(0x22102B3F)],
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 38,
                          height: 38,
                          decoration: const BoxDecoration(
                            color: Color(0xDDFFFFFF),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(icon, color: orange, size: 21),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 19,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 5),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        height: 1.25,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      button,
                      style: const TextStyle(
                        color: Color(0xFF7CFFB1),
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ServicePhotoStrip extends StatelessWidget {
  final String imageUrl;
  final VoidCallback onTap;

  const _ServicePhotoStrip({required this.imageUrl, required this.onTap});

  @override
  Widget build(BuildContext c) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          height: 128,
          child: Stack(
            fit: StackFit.expand,
            children: [
              _NetworkPhoto(imageUrl: imageUrl, icon: Icons.handyman_rounded),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Color(0xDD10213F), Color(0x4410213F)],
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                  ),
                ),
              ),
              const Padding(
                padding: EdgeInsets.all(16),
                child: Align(
                  alignment: Alignment.bottomLeft,
                  child: Text(
                    'Trusted help at home',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                    ),
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

class _NetworkPhoto extends StatelessWidget {
  final String imageUrl;
  final IconData icon;

  const _NetworkPhoto({required this.imageUrl, required this.icon});

  @override
  Widget build(BuildContext c) {
    return Image.network(
      imageUrl,
      fit: BoxFit.cover,
      errorBuilder: (_, __, ___) => Container(
        color: const Color(0xFFE8EEF2),
        alignment: Alignment.center,
        child: Icon(icon, color: orange, size: 64),
      ),
      loadingBuilder: (context, child, progress) {
        if (progress == null) return child;
        return Container(
          color: const Color(0xFFE8EEF2),
          alignment: Alignment.center,
          child: const SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        );
      },
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
