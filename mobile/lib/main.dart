import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'push_service.dart';
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
  if (defaultTargetPlatform == TargetPlatform.android) {
    await Firebase.initializeApp();
    await PushService.initialize();
  }
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
      if(x.role=='provider') WidgetsBinding.instance.addPostFrameCallback((_) => PushService.syncProviderToken(x));
      if(x.role=='customer') WidgetsBinding.instance.addPostFrameCallback((_) => PushService.syncCustomerToken(x));
      return x.role=='provider'
        ?ReferenceProviderHome(session:x,onLogout:()async{await ApiService.clearSession();refresh();})
        :ReferenceCustomerHome(session:x,onLogout:()async{await ApiService.clearSession();refresh();});
    },
  );
}

class RoleScreen extends StatelessWidget {
  final VoidCallback onLogin;
  const RoleScreen({super.key, required this.onLogin});

  static const _customerImage =
      'https://images.unsplash.com/photo-1662499840736-0178ce197a70?auto=format&fit=crop&w=1200&q=82';
  static const _partnerImage =
      'https://images.unsplash.com/photo-1741236922040-ea3a74896c17?auto=format&fit=crop&w=1200&q=82';

  void _openAuth(BuildContext context, String role) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => Auth(role: role, onDone: onLogin)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text('Gofixo',
            style: TextStyle(fontWeight: FontWeight.w900, color: navy)),
        actions: [
          IconButton(
            tooltip: 'App information',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AppInfoPage()),
            ),
            icon: const Icon(Icons.info_outline_rounded, color: navy),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 24, 16, 28),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 560),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Icon(Icons.bolt_rounded, color: orange, size: 38),
                  const SizedBox(height: 8),
                  const Text(
                    'Welcome to Gofixo',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 27, fontWeight: FontWeight.w900, color: navy),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'Choose your Gofixo experience',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 14, color: muted),
                  ),
                  const SizedBox(height: 24),
                  _RolePhotoCard(
                    imageUrl: _customerImage,
                    title: 'I am a Customer',
                    subtitle: 'Book bike, auto or car rides, or find reliable professionals for everyday home needs.',
                    highlights: 'RIDES  •  Electrician  •  Plumber  •  AC repair  •  Cleaning',
                    button: 'CUSTOMER LOGIN  →',
                    icon: Icons.person_rounded,
                    onTap: () => _openAuth(context, 'customer'),
                  ),
                  const SizedBox(height: 16),
                  _RolePhotoCard(
                    imageUrl: _partnerImage,
                    title: 'I am a Partner',
                    subtitle: 'Join as a driver or service professional. Get booking requests, serve customers and grow your earnings.',
                    highlights: 'DRIVER  •  Electrician  •  Plumber  •  Cleaner  •  Beauty & more',
                    button: 'PARTNER LOGIN  →',
                    icon: Icons.handshake_rounded,
                    onTap: () => _openAuth(context, 'provider'),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'One app for rides, home services and earning opportunities',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, color: muted, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          ),
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
  final String highlights;
  final IconData icon;
  final VoidCallback onTap;

  const _RolePhotoCard({
    required this.imageUrl,
    required this.title,
    required this.subtitle,
    required this.button,
    required this.highlights,
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
          height: 228,
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
                padding: const EdgeInsets.all(18),
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
                              fontSize: 20,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      subtitle,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 12,
                        height: 1.3,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      highlights,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Color(0xFFE5FFF0),
                        fontSize: 11,
                        height: 1.3,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
                      decoration: BoxDecoration(
                        color: const Color(0xFF12B85F),
                        borderRadius: BorderRadius.circular(24),
                        boxShadow: const [
                          BoxShadow(color: Color(0x44000000), blurRadius: 10, offset: Offset(0, 3)),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            button.replaceAll('  →', ''),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              letterSpacing: 0.35,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(width: 7),
                          const Icon(Icons.arrow_forward_rounded, color: Colors.white, size: 16),
                        ],
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
 List<Map<String,dynamic>> serviceCatalog=[];
 static const _fallbackServiceCatalog=<Map<String,dynamic>>[
  {'key':'electrician','label':'Electrician','providerType':'skilled_worker'},
  {'key':'plumber','label':'Plumber','providerType':'skilled_worker'},
  {'key':'ac_service','label':'AC Service','providerType':'skilled_worker'},
  {'key':'cleaning','label':'Cleaning','providerType':'general_worker'},
  {'key':'painter','label':'Painter','providerType':'skilled_worker'},
  {'key':'carpenter','label':'Carpenter','providerType':'skilled_worker'},
  {'key':'appliance_repair','label':'Appliance Repair','providerType':'skilled_worker'},
  {'key':'ro_water_purifier','label':'RO & Water Purifier','providerType':'skilled_worker'},
  {'key':'cctv_security','label':'CCTV & Security','providerType':'skilled_worker'},
  {'key':'internet_wifi','label':'Internet & Wi-Fi','providerType':'skilled_worker'},
  {'key':'pest_control','label':'Pest Control','providerType':'general_worker'},
  {'key':'packers_movers','label':'Packers & Movers','providerType':'general_worker'},
  {'key':'salon_beauty','label':'Salon & Beauty','providerType':'general_worker'},
  {'key':'cook','label':'Cook','providerType':'general_worker'},
  {'key':'gardener','label':'Gardener','providerType':'general_worker'},
  {'key':'laundry','label':'Laundry','providerType':'general_worker'},
  {'key':'driver','label':'Personal Driver','providerType':'general_worker'},
  {'key':'tutor','label':'Tutor','providerType':'general_worker'},
  {'key':'babysitter','label':'Babysitter','providerType':'general_worker'},
  {'key':'elder_care','label':'Senior & Disability Care','providerType':'general_worker'},
  {'key':'other','label':'Other Service','providerType':'general_worker'},
 ];
 bool get provider=>widget.role=='provider';
 @override void initState(){super.initState();_loadAppVersion();_loadServiceCatalog();}
 Future<void> _loadServiceCatalog()async{
  try{
   final remote=await ApiService.serviceCatalog();
   if(mounted)setState(()=>serviceCatalog=remote.isEmpty?_fallbackServiceCatalog:remote);
  }catch(_){if(mounted)setState(()=>serviceCatalog=_fallbackServiceCatalog);}
 }
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
       const Text('Work specialties',style:TextStyle(fontWeight:FontWeight.w800,color:navy)),
       const SizedBox(height:4),
       const Text('Choose every service you can professionally deliver.',style:TextStyle(fontSize:11,color:muted)),
       const SizedBox(height:9),
       Wrap(
         spacing:8,runSpacing:8,
         children:serviceCatalog
           .where((item)=>item['providerType']?.toString()==type)
           .map((item){
             final key=item['key']?.toString()??'other';
             final label=item['label']?.toString()??key;
             final selected=serviceCategories.contains(key);
             return FilterChip(
               selected:selected,
               label:Text(label),
               onSelected:(v)=>setState(()=>v?serviceCategories.add(key):serviceCategories.remove(key)),
             );
           }).toList(),
       ),
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
