import 'dart:math';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import 'api_service.dart';

const gfOrange=Color(0xFF12B85F),gfNavy=Color(0xFF10213F),gfMuted=Color(0xFF728097),gfBg=Color(0xFFF4F7FB),gfLine=Color(0xFFE4E9F1),gfGreen=Color(0xFF12B85F);

String gfFormatEta(num? seconds){
  final s=(seconds??0).round();
  if(s<=0)return 'ETA unavailable';
  final minutes=(s/60).ceil();
  if(minutes<60)return '~$minutes min';
  final h=minutes~/60, m=minutes%60;
  return m==0?'~${h}h':'~${h}h ${m}m';
}

String gfFormatDistance(num? meters){
  final m=(meters??0).toDouble();
  if(m<=0)return 'Calculating…';
  if(m<1000)return '${m.round()} m';
  return '${(m/1000).toStringAsFixed(m<10000?1:0)} km';
}

String gfEstimateEta(num? meters){
  final m=(meters??0).toDouble();
  if(m<=0)return 'Calculating…';
  // City-ride fallback only when the live routing service has not returned
  // a duration yet. Once Google Routes responds, its traffic-aware ETA wins.
  final minutes=(m/1000/25*60).ceil();
  return '~${max(1,minutes)} min';
}


class ReferenceCustomerHome extends StatefulWidget{
 final Session session;final Future<void> Function() onLogout;
 const ReferenceCustomerHome({super.key,required this.session,required this.onLogout});
 @override State<ReferenceCustomerHome> createState()=>_ReferenceCustomerHomeState();
}
class _ReferenceCustomerHomeState extends State<ReferenceCustomerHome>{
 List<Map<String,dynamic>> bookings=[];Timer? timer;bool loading=true;int tab=0;
 @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:5),(_)=>load(silent:true));}
 @override void dispose(){timer?.cancel();super.dispose();}
 Future<void> load({bool silent=false})async{try{final b=await ApiService.customerBookings(widget.session.token);if(mounted)setState((){bookings=b;loading=false;});}catch(e){if(mounted&&!silent)_snack(e.toString());}}
 void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
 @override Widget build(BuildContext c){
  if(loading)return const Scaffold(body:Center(child:CircularProgressIndicator()));
  final pages=<Widget>[
   _CustomerHomeTab(session:widget.session,bookings:bookings,onChanged:load,onTab:(i)=>setState(()=>tab=i)),
   _CustomerBookingsTab(session:widget.session,bookings:bookings,onChanged:load),
   _CustomerServicesTab(session:widget.session,onChanged:load),
   _CustomerWalletTab(bookings:bookings),
   _CustomerProfileTab(session:widget.session,onLogout:widget.onLogout),
  ];
  return Scaffold(backgroundColor:gfBg,body:SafeArea(child:IndexedStack(index:tab,children:pages)),bottomNavigationBar:NavigationBar(
   selectedIndex:tab,onDestinationSelected:(i)=>setState(()=>tab=i),height:72,backgroundColor:Colors.white,
   indicatorColor:const Color(0xFFEFFFF5),labelBehavior:NavigationDestinationLabelBehavior.alwaysShow,
   destinations:const[
    NavigationDestination(icon:Icon(Icons.home_outlined),selectedIcon:Icon(Icons.home_rounded,color:gfGreen),label:'Home'),
    NavigationDestination(icon:Icon(Icons.receipt_long_outlined),selectedIcon:Icon(Icons.receipt_long_rounded,color:gfGreen),label:'My Bookings'),
    NavigationDestination(icon:Icon(Icons.grid_view_outlined),selectedIcon:Icon(Icons.grid_view_rounded,color:gfGreen),label:'Services'),
    NavigationDestination(icon:Icon(Icons.account_balance_wallet_outlined),selectedIcon:Icon(Icons.account_balance_wallet_rounded,color:gfGreen),label:'Wallet'),
    NavigationDestination(icon:Icon(Icons.person_outline),selectedIcon:Icon(Icons.person_rounded,color:gfGreen),label:'Profile'),
   ],
  ));
 }
}

class ReferenceProviderHome extends StatefulWidget{
 final Session session;final Future<void> Function() onLogout;
 const ReferenceProviderHome({super.key,required this.session,required this.onLogout});
 @override State<ReferenceProviderHome> createState()=>_ReferenceProviderHomeState();
}
class _ReferenceProviderHomeState extends State<ReferenceProviderHome>{
 Map<String,dynamic>? me;List<Map<String,dynamic>> jobs=[];Timer? timer;bool busy=false,locationBusy=false;int tab=0;
 @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:4),(_)=>load(silent:true));}
 @override void dispose(){timer?.cancel();super.dispose();}
 Future<void> load({bool silent=false})async{try{final m=await ApiService.providerMe(widget.session.token);final j=await ApiService.providerBookings(widget.session.token);final id=int.tryParse(m['id']?.toString()??'');if(m['is_available']==true&&id!=null)await _location(id);if(mounted)setState((){me=m;jobs=j;});}catch(e){if(mounted&&!silent)_snack(e.toString());}}
 Future<void> _location(int id)async{
  if(locationBusy)return;locationBusy=true;
  try{if(!await Geolocator.isLocationServiceEnabled())return;var p=await Geolocator.checkPermission();if(p==LocationPermission.denied)p=await Geolocator.requestPermission();if(p==LocationPermission.denied||p==LocationPermission.deniedForever)return;final x=await Geolocator.getCurrentPosition(locationSettings:const LocationSettings(accuracy:LocationAccuracy.high,distanceFilter:10));await ApiService.updateProviderLocation(widget.session.token,id,x.latitude,x.longitude);}catch(_){}finally{locationBusy=false;}
 }
 Future<void> toggle()async{
  if(me==null)return;final id=int.tryParse(me!['id']?.toString()??'');if(id==null)return;
  if(me!['kyc_status']!='approved'){_snack('KYC approval is required before going online.');return;}
  setState(()=>busy=true);
  try{if(me!['is_available']==true){final x=await ApiService.setAvailability(widget.session.token,id,false);if(mounted)setState(()=>me=x);}else{await _location(id);final x=await ApiService.setAvailability(widget.session.token,id,true);if(mounted)setState(()=>me=x);}}catch(e){_snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}
 }
 void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
 @override Widget build(BuildContext c){
  final pages=<Widget>[
   _ProviderHomeTab(session:widget.session,me:me??{},jobs:jobs,onChanged:load,onOnline:busy?null:toggle),
   _ProviderJobsTab(session:widget.session,jobs:jobs,onChanged:load),
   _ProviderEarningsTab(me:me??{},jobs:jobs),
   _ProviderServicesTab(me:me??{}),
   _ProviderProfileTab(session:widget.session,me:me??{},onLogout:widget.onLogout),
  ];
  return Scaffold(backgroundColor:gfBg,body:SafeArea(child:IndexedStack(index:tab,children:pages)),bottomNavigationBar:NavigationBar(
   selectedIndex:tab,onDestinationSelected:(i)=>setState(()=>tab=i),height:72,backgroundColor:Colors.white,
   indicatorColor:const Color(0xFFEFFFF5),labelBehavior:NavigationDestinationLabelBehavior.alwaysShow,
   destinations:const[
    NavigationDestination(icon:Icon(Icons.dashboard_outlined),selectedIcon:Icon(Icons.dashboard_rounded,color:gfGreen),label:'Home'),
    NavigationDestination(icon:Icon(Icons.work_outline),selectedIcon:Icon(Icons.work_rounded,color:gfGreen),label:'Jobs'),
    NavigationDestination(icon:Icon(Icons.payments_outlined),selectedIcon:Icon(Icons.payments_rounded,color:gfGreen),label:'Earnings'),
    NavigationDestination(icon:Icon(Icons.handyman_outlined),selectedIcon:Icon(Icons.handyman_rounded,color:gfGreen),label:'Services'),
    NavigationDestination(icon:Icon(Icons.person_outline),selectedIcon:Icon(Icons.person_rounded,color:gfGreen),label:'Profile'),
   ],
  ));
 }
}

class _CustomerHomeTab extends StatelessWidget{
 final Session session;final List<Map<String,dynamic>> bookings;final Future<void> Function({bool silent}) onChanged;final ValueChanged<int> onTab;
 const _CustomerHomeTab({required this.session,required this.bookings,required this.onChanged,required this.onTab});
 @override Widget build(BuildContext c){
  final active=bookings.where((b){final s=b['status']?.toString();return s=='requested'||s=='accepted'||s=='arrived'||s=='ongoing';}).toList();
  return RefreshIndicator(onRefresh:onChanged,child:ListView(padding:const EdgeInsets.only(bottom:18),children:[
   _CustomerHeader(onProfile:()=>onTab(4)),const SizedBox(height:6),_CustomerHero(session:session,onChanged:onChanged),const SizedBox(height:18),
   _SectionTitle(title:'Popular rides',onSeeAll:()=>onTab(2)),const SizedBox(height:8),_RideTypeShowcase(session:session,onChanged:onChanged),const SizedBox(height:20),
   _SectionTitle(title:'Home services',onSeeAll:()=>onTab(2)),const SizedBox(height:8),_Services(onTap:(type,category,label)=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,type:type,serviceCategory:category,serviceDescription:label,onChanged:onChanged)))),
   const SizedBox(height:14),_CustomerPromo(onTap:()=>onTab(2)),const SizedBox(height:18),
   const _SectionTitle(title:'Why Gofixo?'),const SizedBox(height:8),const _CustomerBenefits(),
   if(active.isNotEmpty)...[const SizedBox(height:16),_ActiveBookingStrip(b:active.first,session:session)],
  ]));
 }
}

class _CustomerHeader extends StatelessWidget{
 final VoidCallback onProfile;const _CustomerHeader({required this.onProfile});
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.fromLTRB(16,10,12,8),color:Colors.white,child:Row(children:[
  Container(width:43,height:43,decoration:BoxDecoration(color:gfGreen,borderRadius:BorderRadius.circular(14)),child:const Icon(Icons.location_on_rounded,color:Colors.white,size:28)),
  const SizedBox(width:9),const Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text('Gofixo',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900,color:gfNavy,letterSpacing:-.6)),
   Text('Ride · Delivery · Home Services',style:TextStyle(fontSize:8,color:gfMuted,fontWeight:FontWeight.w600))
  ])),
  IconButton(onPressed:(){},icon:const Icon(Icons.notifications_none_rounded,color:gfNavy,size:27)),
  GestureDetector(onTap:onProfile,child:Container(width:41,height:41,decoration:const BoxDecoration(shape:BoxShape.circle,color:Color(0xFFEAFBF2)),child:const Icon(Icons.person_rounded,color:gfGreen,size:25))),
 ]));
}

class _CustomerHero extends StatelessWidget{
 final Session session; final Future<void> Function({bool silent}) onChanged;
 const _CustomerHero({required this.session,required this.onChanged});
 @override Widget build(BuildContext c){
  return Padding(
   padding:const EdgeInsets.symmetric(horizontal:14),
   child:Column(children:[
    ClipRRect(
     borderRadius:BorderRadius.circular(26),
     child:SizedBox(
      height:248,width:double.infinity,
      child:Stack(fit:StackFit.expand,children:[
       Image.network(
        'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1400&q=90',
        fit:BoxFit.cover,
        errorBuilder:(context,error,stack)=>const ColoredBox(color:Color(0xFF16334A)),
       ),
       DecoratedBox(decoration:BoxDecoration(
        gradient:LinearGradient(
         begin:Alignment.topCenter,
         end:Alignment.bottomCenter,
         colors:[Colors.black.withValues(alpha:.08),Colors.black.withValues(alpha:.72)],
        ),
       )),
       Positioned(left:20,right:20,top:20,child:Row(children:[
        Container(
         padding:const EdgeInsets.symmetric(horizontal:10,vertical:6),
         decoration:BoxDecoration(color:Colors.white.withValues(alpha:.92),borderRadius:BorderRadius.circular(20)),
         child:const Row(mainAxisSize:MainAxisSize.min,children:[
          Icon(Icons.verified_rounded,color:gfGreen,size:15),
          SizedBox(width:5),
          Text('Trusted local rides',style:TextStyle(fontSize:10,fontWeight:FontWeight.w900,color:gfNavy)),
         ]),
        ),
        const Spacer(),
        Container(
         width:34,height:34,
         decoration:BoxDecoration(color:Colors.black.withValues(alpha:.28),shape:BoxShape.circle),
         child:const Icon(Icons.more_horiz_rounded,color:Colors.white),
        ),
       ])),
       const Positioned(left:20,right:20,bottom:58,child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text('Go anywhere.',style:TextStyle(color:Colors.white,fontSize:29,fontWeight:FontWeight.w900,height:1.0)),
        SizedBox(height:3),
        Text('Get there with Gofixo.',style:TextStyle(color:Colors.white,fontSize:18,fontWeight:FontWeight.w700)),
        SizedBox(height:5),
        Text('Live routes • Upfront fare • Real-time ride tracking',style:TextStyle(color:Colors.white70,fontSize:10,fontWeight:FontWeight.w600)),
       ])),
       Positioned(left:16,right:16,bottom:12,child:InkWell(
        onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,onChanged:onChanged))),
        borderRadius:BorderRadius.circular(16),
        child:Container(
         height:42,
         decoration:BoxDecoration(color:gfGreen,borderRadius:BorderRadius.circular(16),boxShadow:const[BoxShadow(color:Color(0x44000000),blurRadius:10,offset:Offset(0,4))]),
         child:const Row(mainAxisAlignment:MainAxisAlignment.center,children:[
          Icon(Icons.navigation_rounded,color:Colors.white,size:18),
          SizedBox(width:7),
          Text('Book a ride',style:TextStyle(color:Colors.white,fontSize:14,fontWeight:FontWeight.w900)),
         ]),
        ),
       )),
      ]),
     ),
    ),
    const SizedBox(height:10),
    InkWell(
     onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,onChanged:onChanged))),
     borderRadius:BorderRadius.circular(20),
     child:Container(
      padding:const EdgeInsets.symmetric(horizontal:14,vertical:11),
      decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(20),border:Border.all(color:gfLine),boxShadow:const[BoxShadow(color:Color(0x10000000),blurRadius:12,offset:Offset(0,4))]),
      child:Row(children:[
       Container(width:38,height:38,decoration:const BoxDecoration(color:Color(0xFFEFFFF5),shape:BoxShape.circle),child:const Icon(Icons.search_rounded,color:gfGreen,size:21)),
       const SizedBox(width:10),
       const Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text('Where to?',style:TextStyle(fontSize:10,color:gfMuted,fontWeight:FontWeight.w700)),
        Text('Enter destination',style:TextStyle(fontSize:14,color:gfNavy,fontWeight:FontWeight.w900)),
       ])),
       const Icon(Icons.chevron_right_rounded,color:gfMuted,size:22),
      ]),
     ),
    ),
   ]),
  );
}
}

class _LiveMetric extends StatelessWidget{
  final IconData icon; final String label; final String value;
  const _LiveMetric({required this.icon,required this.label,required this.value});
  @override Widget build(BuildContext c)=>Container(
    padding:const EdgeInsets.symmetric(horizontal:10,vertical:9),
    decoration:BoxDecoration(color:gfBg,borderRadius:BorderRadius.circular(14)),
    child:Row(children:[
      Icon(icon,color:gfGreen,size:19),
      const SizedBox(width:7),
      Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text(label,style:const TextStyle(fontSize:9,color:gfMuted,fontWeight:FontWeight.w700)),
        Text(value,style:const TextStyle(fontSize:14,color:gfNavy,fontWeight:FontWeight.w900)),
      ])),
    ]),
  );
}
class _MapControl extends StatelessWidget{
 final IconData icon;final VoidCallback onTap;
 const _MapControl({required this.icon,required this.onTap});
 @override Widget build(BuildContext c)=>Material(color:Colors.white,borderRadius:BorderRadius.circular(12),elevation:3,child:InkWell(onTap:onTap,borderRadius:BorderRadius.circular(12),child:SizedBox(width:44,height:44,child:Icon(icon,color:gfNavy,size:22))));
}
class _Partner extends StatelessWidget{final Map<String,dynamic>m;const _Partner({required this.m});@override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(22)),child:Row(children:[Container(width:58,height:58,padding:const EdgeInsets.all(4),decoration:const BoxDecoration(shape:BoxShape.circle,color:Color(0xFFEFFFF5)),child:ClipOval(child:Image.network('https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=85',fit:BoxFit.cover,errorBuilder:(_,__,___)=>const Icon(Icons.person,color:gfGreen,size:34)))),const SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('PARTNER PROFILE',style:TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfGreen)),Text(m['name']?.toString()??'Partner',style:const TextStyle(fontSize:19,fontWeight:FontWeight.w900,color:gfNavy)),Text((m['type']?.toString()??'partner').replaceAll('_',' ')+' · '+(m['generated_id']?.toString()??''),style:const TextStyle(fontSize:11,color:gfMuted))])),const Icon(Icons.chevron_right,color:gfMuted)]));}
class _Services extends StatelessWidget{
 final void Function(String type,String category,String label) onTap;
 const _Services({required this.onTap});
 @override Widget build(BuildContext c)=>GridView.count(
   crossAxisCount:4,crossAxisSpacing:7,mainAxisSpacing:9,childAspectRatio:.72,
   shrinkWrap:true,physics:const NeverScrollableScrollPhysics(),
   children:[
    _Service('https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=500&q=80','Electrician',()=>onTap('skilled_worker','electrician','Electrician')),
    _Service('https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=500&q=80','Plumber',()=>onTap('skilled_worker','plumber','Plumber')),
    _Service('https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=500&q=80','AC Service',()=>onTap('skilled_worker','ac_service','AC Service')),
    _Service('https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=500&q=80','Cleaning',()=>onTap('general_worker','cleaning','Cleaning')),
    _Service('https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=500&q=80','Painter',()=>onTap('skilled_worker','painter','Painter')),
    _Service('https://images.unsplash.com/photo-1601058268499-e52658a84c9d?auto=format&fit=crop&w=500&q=80','Carpenter',()=>onTap('skilled_worker','carpenter','Carpenter')),
    _Service('https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=500&q=80','Appliance Repair',()=>onTap('skilled_worker','appliance_repair','Appliance Repair')),
    _Service('https://images.unsplash.com/photo-1521791055366-0d553872125f?auto=format&fit=crop&w=500&q=80','More Services',()=>onTap('general_worker','other','Other')),
   ],
 );
}
class _Service extends StatelessWidget {
  final String url;
  final String label;
  final VoidCallback tap;
  const _Service(this.url, this.label, this.tap);
  @override
  Widget build(BuildContext c) {
    return InkWell(
      onTap: tap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: gfLine),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(
                  url,
                  fit: BoxFit.cover,
                  width: double.infinity,
                  errorBuilder: (_, __, ___) => const ColoredBox(
                    color: Color(0xFFE8EEF5),
                    child: Icon(Icons.handyman_outlined),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 8, fontWeight: FontWeight.w900, color: gfNavy),
            ),
          ],
        ),
      ),
    );
  }
}

class _Choice extends StatelessWidget{final String label,value;final IconData icon;final String selected;final ValueChanged<String>onTap;const _Choice(this.label,this.value,this.icon,this.selected,this.onTap);String get _url=>value=='bike'?'https://images.unsplash.com/photo-1679465427762-38cfdba8e2fb?auto=format&fit=crop&w=900&q=85':value=='auto'?'https://images.unsplash.com/photo-1626149637281-4e227308da18?auto=format&fit=crop&w=900&q=85':'https://images.unsplash.com/photo-1685019718640-6e562edc365e?auto=format&fit=crop&w=900&q=85';@override Widget build(BuildContext c)=>InkWell(onTap:()=>onTap(value),borderRadius:BorderRadius.circular(15),child:Container(height:112,padding:const EdgeInsets.all(6),decoration:BoxDecoration(color:selected==value?const Color(0xFFEFFFF5):Colors.white,border:Border.all(color:selected==value?gfGreen:gfLine,width:selected==value?1.5:1),borderRadius:BorderRadius.circular(15)),child:Column(children:[Expanded(child:ClipRRect(borderRadius:BorderRadius.circular(11),child:Image.network(_url,fit:BoxFit.cover,width:double.infinity,errorBuilder:(_,__,___)=>Icon(icon,color:gfGreen,size:30)))),Text(label,style:TextStyle(fontSize:10,fontWeight:FontWeight.w900,color:selected==value?gfGreen:gfNavy))])));}
class _Title extends StatelessWidget{
 final String kicker,title;
 const _Title({required this.kicker,required this.title});
 @override Widget build(BuildContext c)=>Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
  Text(kicker,style:const TextStyle(fontSize:8,letterSpacing:1.5,fontWeight:FontWeight.w900,color:gfGreen)),
  Text(title,style:const TextStyle(fontSize:20,fontWeight:FontWeight.w900,color:gfNavy))
 ]);
}
class _Stat extends StatelessWidget{
 final String label,value; final IconData icon;
 const _Stat(this.label,this.value,this.icon);
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.symmetric(vertical:13,horizontal:5),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(17)),child:Column(children:[
  Icon(icon,color:gfGreen,size:18),const SizedBox(height:4),Text(value,maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),Text(label,textAlign:TextAlign.center,style:const TextStyle(fontSize:8,color:gfMuted))
 ]));
}
class _Keep extends StatelessWidget{
 const _Keep();
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(15),decoration:BoxDecoration(color:const Color(0xFFFFF7E8),borderRadius:BorderRadius.circular(20)),child:const Row(children:[
  Text('🏆',style:TextStyle(fontSize:24)),SizedBox(width:10),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text('Keep Going!',style:TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
   Text('Stay online and accept nearby jobs to grow your earnings.',style:TextStyle(fontSize:10,color:gfMuted))
  ]))
 ]));
}
class _Waiting extends StatelessWidget{
 const _Waiting();
 @override Widget build(BuildContext c)=>_Box(child:Column(children:const[
  Icon(Icons.radar,color:gfGreen,size:35),SizedBox(height:7),
  Text('Waiting for your next ride',style:TextStyle(fontWeight:FontWeight.w800,color:gfNavy)),
  Text('Stay online and nearby requests will appear here.',style:TextStyle(fontSize:10,color:gfMuted))
 ]));
}
class _Incoming extends StatelessWidget{
 final Session session; final Map<String,dynamic>b; final Future<void> Function({bool silent}) changed;
 const _Incoming({required this.session,required this.b,required this.changed});
 @override Widget build(BuildContext c){
  final id=int.tryParse(b['id']?.toString()??'')??0;final isService=b['service_type']=='services';
  return _Box(child:Column(children:[
   Row(children:[Icon(isService?Icons.handyman_outlined:Icons.notifications_active,color:gfGreen),const SizedBox(width:7),Expanded(child:Text(isService?'New service request':'New ride request',style:const TextStyle(fontSize:16,fontWeight:FontWeight.w900,color:gfNavy))),Text('₹'+(b['fare_amount']??0).toString(),style:const TextStyle(fontWeight:FontWeight.w900))]),
   if(isService)...[
     const SizedBox(height:6),
     Align(alignment:Alignment.centerLeft,child:Text((b['service_category']?.toString()??'other').replaceAll('_',' ').toUpperCase(),style:const TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfGreen))),
     Align(alignment:Alignment.centerLeft,child:Text(b['service_description']?.toString()??'',maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:11,color:gfMuted))),
   ],
   const SizedBox(height:10),_Route('Pickup',b['pickup_location']?.toString()??''),_Route(isService?'Service address':'Drop',b['drop_or_service_address']?.toString()??''),const SizedBox(height:10),
   Row(children:[
    Expanded(child:OutlinedButton(onPressed:()async{await ApiService.declineBooking(session.token,id);await changed();},child:const Text('Reject'))),
    const SizedBox(width:8),
    Expanded(child:FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:()async{try{await ApiService.acceptBooking(session.token,id);await changed();}catch(e){ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}},child:const Text('Accept')))
   ])
  ]));
 }
}
class _Active extends StatefulWidget{
 final Session session; final Map<String,dynamic>b; final Future<void> Function({bool silent})changed;
 const _Active({required this.session,required this.b,required this.changed});
 @override State<_Active> createState()=>_ActiveState();
}
class _ActiveState extends State<_Active>{
 final pin=TextEditingController(); bool submitting=false;
 @override void dispose(){pin.dispose();super.dispose();}
 @override Widget build(BuildContext c){
  final id=int.tryParse(widget.b['id']?.toString()??'')??0;
  final status=widget.b['status']?.toString()??'';
  final accepted=status=='accepted';
  final arrived=status=='arrived';
  final ongoing=status=='ongoing';

  Future<void>markArrived()async{
   if(submitting)return;
   setState(()=>submitting=true);
   try{await ApiService.markArrived(widget.session.token,id);await widget.changed();}
   catch(e){if(mounted)ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}
   finally{if(mounted)setState(()=>submitting=false);}
  }

  Future<void>startTrip()async{
   if(pin.text.length!=4||submitting)return;
   setState(()=>submitting=true);
   try{await ApiService.startBooking(widget.session.token,id,pin.text);await widget.changed();}
   catch(e){if(mounted)ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}
   finally{if(mounted)setState(()=>submitting=false);}
  }

  return _Box(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text(ongoing?'TRIP IN PROGRESS':arrived?'ARRIVED AT PICKUP':'ON THE WAY',style:const TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:gfGreen)),
   const SizedBox(height:4),
   Text(ongoing?'Confirm payment to complete':arrived?'Enter customer PIN to start the trip':'Navigate to pickup',style:const TextStyle(fontSize:18,fontWeight:FontWeight.w900,color:gfNavy)),
   const SizedBox(height:10),
   _Route('Pickup',widget.b['pickup_location']?.toString()??''),
   if(widget.b['drop_or_service_address']!=null&&widget.b['drop_or_service_address'].toString().trim().isNotEmpty)
     _Route('Drop',widget.b['drop_or_service_address']?.toString()??''),

   if(accepted)...[
    const SizedBox(height:4),
    Container(width:double.infinity,padding:const EdgeInsets.all(12),decoration:BoxDecoration(color:const Color(0xFFEFFFF5),borderRadius:BorderRadius.circular(14)),child:const Row(children:[
     Icon(Icons.near_me_rounded,color:gfGreen),SizedBox(width:8),Expanded(child:Text('You are on the way. Mark arrival when you reach the pickup point.',style:TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:gfNavy)))
    ])),
    const SizedBox(height:8),
    SizedBox(width:double.infinity,child:FilledButton.icon(
      style:FilledButton.styleFrom(backgroundColor:gfGreen),
      onPressed:submitting?null:markArrived,
      icon:const Icon(Icons.place_rounded),
      label:Text(submitting?'Saving…':'I have arrived at pickup →'),
    )),
   ],

   if(arrived)...[
    const SizedBox(height:4),
    Container(width:double.infinity,padding:const EdgeInsets.all(12),decoration:BoxDecoration(color:const Color(0xFFFFF7E8),borderRadius:BorderRadius.circular(14)),child:const Row(children:[
     Icon(Icons.lock_outline_rounded,color:gfGreen),SizedBox(width:8),Expanded(child:Text('Ask the customer for the 4-digit start PIN. The trip begins only after verification.',style:TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:gfNavy)))
    ])),
    const SizedBox(height:8),
    TextField(controller:pin,maxLength:4,keyboardType:TextInputType.number,onChanged:(_)=>setState((){}),decoration:const InputDecoration(labelText:'Customer 4-digit PIN')),
    SizedBox(width:double.infinity,child:FilledButton.icon(
      style:FilledButton.styleFrom(backgroundColor:gfGreen),
      onPressed:pin.text.length==4&&!submitting?startTrip:null,
      icon:const Icon(Icons.play_arrow_rounded),
      label:Text(submitting?'Starting…':'Start trip →'),
    )),
   ],

   if(ongoing)...[
     Container(
       width:double.infinity,
       padding:const EdgeInsets.all(13),
       decoration:BoxDecoration(color:const Color(0xFFEFFFF5),borderRadius:BorderRadius.circular(14)),
       child:Row(children:[
         const Icon(Icons.lock_outline_rounded,color:gfGreen),
         const SizedBox(width:9),
         Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
           const Text('UPFRONT FARE',style:TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:gfGreen)),
           Text('₹'+(widget.b['fare_amount']??0).toString(),style:const TextStyle(fontSize:22,fontWeight:FontWeight.w900,color:gfNavy)),
           const Text('Fare is locked to the customer estimate',style:TextStyle(fontSize:10,color:gfMuted)),
         ])),
       ]),
     ),
     const SizedBox(height:8),
     SizedBox(width:double.infinity,child:FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:submitting?null:()async{
      final value=double.tryParse(widget.b['fare_amount']?.toString()??'');
      if(value==null||value<=0){ScaffoldMessenger.of(c).showSnackBar(const SnackBar(content:Text('Locked fare is unavailable.')));return;}
      setState(()=>submitting=true);
      try{await ApiService.confirmPayment(widget.session.token,id,value);await widget.changed();}
      catch(e){if(mounted)ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}
      finally{if(mounted)setState(()=>submitting=false);}
     },child:Text(submitting?'Saving…':'Confirm payment received →'))),
   ],

   const SizedBox(height:6),
   if(accepted||arrived||ongoing)
     OutlinedButton.icon(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>LiveTrackingPage(session:widget.session,booking:widget.b,isProvider:true))),icon:const Icon(Icons.map_outlined),label:const Text('Open live map')),
  ]));
}
}
class _Booking extends StatelessWidget{
 final Map<String,dynamic>b; final Session session; final Future<void> Function({bool silent})onChanged;
 const _Booking({required this.b,required this.session,required this.onChanged});
 @override Widget build(BuildContext c){
  final s=b['status']?.toString()??'';final id=b['id']?.toString()??'';final isService=b['service_type']=='services';
  return Container(margin:const EdgeInsets.only(bottom:8),padding:const EdgeInsets.all(13),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(18)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Row(children:[Expanded(child:Text('#'+id+' · '+s.toUpperCase(),style:const TextStyle(fontWeight:FontWeight.w800,color:gfNavy))),Text('₹'+(b['fare_amount']??b['estimated_fare']??0).toString(),style:const TextStyle(fontWeight:FontWeight.w900))]),
   if(isService)Text((b['service_category']?.toString()??'other').replaceAll('_',' ').toUpperCase(),style:const TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfGreen)),
   if(isService)Text(b['service_description']?.toString()??'',maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(color:gfMuted)),
   Text(b['pickup_location']?.toString()??'',maxLines:1,overflow:TextOverflow.ellipsis),
   Text((isService?'Service address: ':'→ ')+(b['drop_or_service_address']?.toString()??''),maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(color:gfMuted)),
   if(s=='requested'||s=='accepted')Align(alignment:Alignment.centerRight,child:TextButton(onPressed:()async{await ApiService.cancelBooking(session.token,int.tryParse(id)??0);await onChanged();},child:const Text('Cancel'))),
   if(s=='accepted'||s=='arrived'||s=='ongoing')Align(alignment:Alignment.centerRight,child:OutlinedButton.icon(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>LiveTrackingPage(session:session,booking:b,isProvider:false))),icon:const Icon(Icons.location_searching),label:const Text('Track live')))
  ]));
 }
}
class CompletedRidesPage extends StatefulWidget{
 final Session session;
 final List<Map<String,dynamic>> bookings;
 final Future<void> Function() onRefresh;
 const CompletedRidesPage({super.key,required this.session,required this.bookings,required this.onRefresh});
 @override State<CompletedRidesPage> createState()=>_CompletedRidesPageState();
}

class _CompletedRidesPageState extends State<CompletedRidesPage>{
 late List<Map<String,dynamic>> bookings;
 bool loading=false;

 @override void initState(){
  super.initState();
  bookings=List<Map<String,dynamic>>.from(widget.bookings);
 }

 List<Map<String,dynamic>> get completed=>bookings.where((b){
  final status=b['status']?.toString().toLowerCase().trim()??'';
  final serviceType=b['service_type']?.toString().toLowerCase().trim()??'ride';
  return serviceType!='services'&&
    (status=='completed'||status=='finished'||status=='paid');
 }).toList();

 Future<void>refresh()async{
  if(loading)return;
  setState(()=>loading=true);
  try{
   final latest=await ApiService.customerBookings(widget.session.token);
   if(mounted)setState(()=>bookings=latest);
   await widget.onRefresh();
  }catch(e){
   if(mounted)ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))),
   );
  }finally{
   if(mounted)setState(()=>loading=false);
  }
 }

 @override Widget build(BuildContext c)=>Scaffold(
  backgroundColor:gfBg,
  appBar:AppBar(
   title:const Text('Completed rides',style:TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
   backgroundColor:gfBg,
   elevation:0,
   actions:[
    IconButton(
     onPressed:loading?null:refresh,
     icon:loading
       ?const SizedBox(width:20,height:20,child:CircularProgressIndicator(strokeWidth:2))
       :const Icon(Icons.refresh_rounded),
    ),
   ],
  ),
  body:RefreshIndicator(
   onRefresh:refresh,
   child:ListView(
    padding:const EdgeInsets.fromLTRB(14,8,14,28),
    children:[
     Container(
      padding:const EdgeInsets.all(18),
      decoration:BoxDecoration(
       color:gfNavy,
       borderRadius:BorderRadius.circular(22),
      ),
      child:Row(children:[
       Container(
        width:48,height:48,
        decoration:BoxDecoration(color:gfGreen.withOpacity(.16),shape:BoxShape.circle),
        child:const Icon(Icons.check_circle_rounded,color:gfGreen,size:28),
       ),
       const SizedBox(width:12),
       Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        const Text('Your completed rides',style:TextStyle(color:Colors.white,fontSize:17,fontWeight:FontWeight.w900)),
        Text('${completed.length} completed ride${completed.length==1?'':'s'}',style:const TextStyle(color:Colors.white70,fontSize:12)),
       ])),
      ]),
     ),
     const SizedBox(height:14),
     if(completed.isEmpty)
      const _Box(child:Column(children:[
       Icon(Icons.history_rounded,color:gfMuted,size:42),
       SizedBox(height:8),
       Text('No completed rides yet',style:TextStyle(fontSize:16,fontWeight:FontWeight.w900,color:gfNavy)),
       SizedBox(height:4),
       Text('Your finished bike, auto and car rides will appear here.',textAlign:TextAlign.center,style:TextStyle(fontSize:11,color:gfMuted)),
      ]))
     else
      ...completed.map((b)=>_CompletedRideCard(b:b)),
    ],
   ),
  ),
 );
}

class _CompletedRideCard extends StatelessWidget{
 final Map<String,dynamic>b;
 const _CompletedRideCard({required this.b});

 @override Widget build(BuildContext c){
  final id=b['id']?.toString()??'';
  final fare=b['fare_amount']??b['final_fare']??b['estimated_fare']??0;
  final type=(b['provider_type']?.toString()??'ride').toUpperCase();
  final date=b['completed_at']??b['updated_at']??b['created_at'];
  return Container(
   margin:const EdgeInsets.only(bottom:10),
   padding:const EdgeInsets.all(15),
   decoration:BoxDecoration(
    color:Colors.white,
    border:Border.all(color:gfLine),
    borderRadius:BorderRadius.circular(20),
   ),
   child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    Row(children:[
     Container(
      width:42,height:42,
      decoration:BoxDecoration(color:const Color(0xFFEFFFF5),borderRadius:BorderRadius.circular(13)),
      child:Icon(
       type=='BIKE'?Icons.two_wheeler:type=='AUTO'?Icons.electric_rickshaw:Icons.directions_car,
       color:gfGreen,
      ),
     ),
     const SizedBox(width:10),
     Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      Text(type,style:const TextStyle(fontSize:12,fontWeight:FontWeight.w900,color:gfNavy)),
      if(id.isNotEmpty)Text('#$id',style:const TextStyle(fontSize:10,color:gfMuted)),
     ])),
     Text('₹${fare.toString()}',style:const TextStyle(fontSize:17,fontWeight:FontWeight.w900,color:gfNavy)),
    ]),
    const SizedBox(height:12),
    _Route('Pickup',b['pickup_location']?.toString()??''),
    _Route('Drop',b['drop_or_service_address']?.toString()??''),
    if(date!=null&&date.toString().isNotEmpty)
     Padding(
      padding:const EdgeInsets.only(top:2),
      child:Text(_dateText(date),style:const TextStyle(fontSize:10,color:gfMuted)),
     ),
   ]),
  );
 }

 static String _dateText(dynamic value){
  final raw=value.toString();
  final d=DateTime.tryParse(raw)?.toLocal();
  if(d==null)return raw;
  String two(int n)=>n.toString().padLeft(2,'0');
  return '${two(d.day)}/${two(d.month)}/${d.year} · ${two(d.hour)}:${two(d.minute)}';
 }
}

class _Box extends StatelessWidget{
 final Widget child; const _Box({required this.child});
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(20)),child:child);
}
class _Location extends StatelessWidget{
 final String pickup; final VoidCallback? onTap;
 const _Location({required this.pickup,required this.onTap});
 @override Widget build(BuildContext c)=>_Box(child:Row(children:[
  const Icon(Icons.my_location,color:gfGreen),const SizedBox(width:9),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   const Text('PICKUP',style:TextStyle(fontSize:8,fontWeight:FontWeight.w800,color:gfMuted)),
   Text(pickup,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:12,fontWeight:FontWeight.w700,color:gfNavy))
  ])),IconButton(onPressed:onTap,icon:const Icon(Icons.gps_fixed,color:gfGreen))
 ]));
}
class _Route extends StatelessWidget{final String label,value;const _Route(this.label,this.value);@override Widget build(BuildContext c)=>Padding(padding:const EdgeInsets.only(bottom:7),child:Row(children:[Icon(label=='Pickup'?Icons.my_location:Icons.location_on,color:label=='Pickup'?gfGreen:gfOrange,size:17),const SizedBox(width:7),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(label.toUpperCase(),style:const TextStyle(fontSize:7,color:gfMuted,fontWeight:FontWeight.w800)),Text(value,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:gfNavy))]))]));}
Future<String> _reverse(double lat,double lon)async{try{final marks=await placemarkFromCoordinates(lat,lon);if(marks.isNotEmpty){final p=marks.first;final values=<String?>[p.name,p.street,p.subLocality,p.locality,p.subAdministrativeArea,p.administrativeArea,p.postalCode,p.country];final parts=values.whereType<String>().map((v)=>v.trim()).where((v)=>v.isNotEmpty).toList();final out=<String>[];for(final part in parts){if(!out.any((x)=>x.toLowerCase()==part.toLowerCase()))out.add(part);}if(out.isNotEmpty)return out.join(', ');}}catch(_){ }return '$lat, $lon';}
List<LatLng> _decodeGooglePolyline(String encoded){final points=<LatLng>[];var index=0;var lat=0;var lng=0;while(index<encoded.length){var result=0;var shift=0;int b;do{b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32&&index<encoded.length);lat+=((result&1)!=0?~(result>>1):(result>>1));result=0;shift=0;do{b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32&&index<encoded.length);lng+=((result&1)!=0?~(result>>1):(result>>1));points.add(LatLng(lat/1e5,lng/1e5));}return points;}



class LiveTrackingPage extends StatefulWidget{
  final Session session;
  final Map<String,dynamic> booking;
  final bool isProvider;
  const LiveTrackingPage({super.key,required this.session,required this.booking,required this.isProvider});
  @override State<LiveTrackingPage> createState()=>_LiveTrackingPageState();
}
class _LiveTrackingPageState extends State<LiveTrackingPage>{
  WebSocketChannel? channel;
  StreamSubscription<Position>? gpsSub;
  Timer? reconnectTimer;
  Timer? pollTimer;
  Timer? routeTimer;
  LatLng? providerPoint;
  LatLng? pickupPoint;
  LatLng? destinationPoint;
  LatLng? lastRoutedPoint;
  Set<Polyline> routeLines={};
  double? routeDistanceMeters;
  double? routeEtaSeconds;
  String status='';
  bool connecting=false;
  bool followCamera=true;
  bool movingCamera=false;

  @override void initState(){
    super.initState();
    status=widget.booking['status']?.toString()??'';
    final plat=double.tryParse(widget.booking['pickup_lat']?.toString()??'');
    final plng=double.tryParse(widget.booking['pickup_lng']?.toString()??'');
    if(plat!=null&&plng!=null)pickupPoint=LatLng(plat,plng);
    final dlat=double.tryParse((widget.booking['drop_lat']??widget.booking['drop_latitude'])?.toString()??'');
    final dlng=double.tryParse((widget.booking['drop_lng']??widget.booking['drop_longitude'])?.toString()??'');
    if(dlat!=null&&dlng!=null)destinationPoint=LatLng(dlat,dlng);
    final vlat=double.tryParse(widget.booking['provider_lat']?.toString()??'');
    final vlng=double.tryParse(widget.booking['provider_lng']?.toString()??'');
    if(vlat!=null&&vlng!=null)providerPoint=LatLng(vlat,vlng);
    if(widget.isProvider){
      _startProviderGps();
      routeTimer=Timer.periodic(const Duration(seconds:20),(_)=>_refreshRoute());
      _refreshRoute();
    }else{
      _connectRealtime();
      _startBookingPoll();
      routeTimer=Timer.periodic(const Duration(seconds:20),(_)=>_refreshRoute());
      _refreshRoute();
    }
  }

  @override void dispose(){
    gpsSub?.cancel();
    pollTimer?.cancel();
    routeTimer?.cancel();
    reconnectTimer?.cancel();
    channel?.sink.close();
    super.dispose();
  }

  void _connectRealtime(){
    if(connecting||!mounted)return;
    connecting=true;
    try{
      final ch=ApiService.realtimeChannel(widget.session.token);
      channel=ch;
      ch.sink.add(jsonEncode({'type':'subscribe_booking','booking_id':widget.booking['id']}));
      ch.stream.listen((raw){
        try{
          final d=jsonDecode(raw.toString());
          if(d is Map&&d['type']=='provider_location'){
            final lat=double.tryParse(d['lat']?.toString()??'');
            final lng=double.tryParse(d['lng']?.toString()??'');
            if(lat!=null&&lng!=null&&mounted){
              setState(()=>providerPoint=LatLng(lat,lng));
              _followProvider();
            }
          }
        }catch(_){}
      },onDone:_scheduleReconnect,onError:(_,__)=>_scheduleReconnect());
    }catch(_){
      _scheduleReconnect();
    }finally{
      connecting=false;
    }
  }

  void _scheduleReconnect(){
    if(!mounted||reconnectTimer?.isActive==true)return;
    reconnectTimer=Timer(const Duration(seconds:3),(){reconnectTimer=null;_connectRealtime();});
  }

  void _startBookingPoll(){
    pollTimer=Timer.periodic(const Duration(seconds:5),(_)=>_refreshBooking());
  }

  Future<void>_refreshBooking()async{
    try{
      final all=await ApiService.customerBookings(widget.session.token);
      final id=widget.booking['id']?.toString();
      Map<String,dynamic>? b;
      for(final x in all){if(x['id']?.toString()==id){b=x;break;}}
      if(b==null||!mounted)return;
      final lat=double.tryParse(b['provider_lat']?.toString()??'');
      final lng=double.tryParse(b['provider_lng']?.toString()??'');
      setState((){
        status=b!['status']?.toString()??status;
        if(lat!=null&&lng!=null)providerPoint=LatLng(lat,lng);
      });
      if(status=='completed'||status=='cancelled'||status=='no_provider'){
        await channel?.sink.close();
      }
      _followProvider();
    }catch(_){}
  }

  void _startProviderGps(){
    gpsSub?.cancel();
    gpsSub=Geolocator.getPositionStream(locationSettings:const LocationSettings(accuracy:LocationAccuracy.bestForNavigation,distanceFilter:5)).listen((x){
      if(!mounted||x.accuracy>150)return;
      setState(()=>providerPoint=LatLng(x.latitude,x.longitude));
    });
  }

  Future<void>_refreshRoute()async{
    if(providerPoint==null)return;
    final p=providerPoint!;
    final target=(status=='ongoing'&&destinationPoint!=null)?destinationPoint:pickupPoint;
    if(target==null)return;
    if(lastRoutedPoint!=null&&Geolocator.distanceBetween(lastRoutedPoint!.latitude,lastRoutedPoint!.longitude,p.latitude,p.longitude)<100)return;
    try{
      final r=await ApiService.computeRoute(p.latitude,p.longitude,target.latitude,target.longitude);
      final pts=_decodeGooglePolyline(r['encodedPolyline']?.toString()??'');
      final distance=double.tryParse(r['distanceMeters']?.toString()??'');
      final eta=double.tryParse(r['durationSeconds']?.toString()??'');
      if(pts.length>=2&&mounted){
        setState((){
          routeLines={Polyline(polylineId:const PolylineId('partner-route'),points:pts,color:gfGreen,width:5)};
          routeDistanceMeters=distance;
          routeEtaSeconds=(eta!=null&&eta>0)?eta:(distance!=null&&distance>0?distance/1000/25*3600:null);
        });
        lastRoutedPoint=p;
      }
    }catch(_){}
  }

  List<LatLng>_decodeGooglePolyline(String encoded){
    final points=<LatLng>[];var index=0,lat=0,lng=0;
    while(index<encoded.length){
      var result=0,shift=0;int b;
      do{if(index>=encoded.length)return points;b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);
      lat+=((result&1)!=0?~(result>>1):(result>>1));
      result=0;shift=0;
      do{if(index>=encoded.length)return points;b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);
      lng+=((result&1)!=0?~(result>>1):(result>>1));
      points.add(LatLng(lat/1e5,lng/1e5));
    }
    return points;
  }

  Future<void>_fitAllPoints()async{
    final map=mapController;
    if(map==null)return;
    final points=<LatLng>[if(pickupPoint!=null)pickupPoint!,if(destinationPoint!=null)destinationPoint!,if(providerPoint!=null)providerPoint!];
    for(final line in routeLines)points.addAll(line.points);
    if(points.isEmpty)return;
    try{
      if(points.length==1){await map.animateCamera(CameraUpdate.newLatLngZoom(points.first,15));return;}
      var minLat=points.first.latitude,maxLat=points.first.latitude,minLng=points.first.longitude,maxLng=points.first.longitude;
      for(final p in points.skip(1)){minLat=min(minLat,p.latitude);maxLat=max(maxLat,p.latitude);minLng=min(minLng,p.longitude);maxLng=max(maxLng,p.longitude);}
      final latPad=(maxLat-minLat).abs()*0.10,lngPad=(maxLng-minLng).abs()*0.10;
      await map.animateCamera(CameraUpdate.newLatLngBounds(LatLngBounds(
        southwest:LatLng(minLat-latPad,minLng-lngPad),northeast:LatLng(maxLat+latPad,maxLng+lngPad)),90));
    }catch(_){}
  }

  void _followProvider(){
    final map=mapController;
    final point=providerPoint;
    if(!followCamera||point==null||map==null)return;
    movingCamera=true;
    map.animateCamera(CameraUpdate.newLatLng(point)).whenComplete(()=>Future.delayed(const Duration(milliseconds:500),(){if(mounted)movingCamera=false;}));
  }

  GoogleMapController? mapController;

  @override Widget build(BuildContext c){
    final center=providerPoint??pickupPoint??const LatLng(28.6139,77.2090);
    final markers=<Marker>{
      if(pickupPoint!=null)Marker(markerId:const MarkerId('pickup'),position:pickupPoint!,infoWindow:const InfoWindow(title:'Pickup')),
      if(destinationPoint!=null)Marker(markerId:const MarkerId('destination'),position:destinationPoint!,icon:BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),infoWindow:const InfoWindow(title:'Destination')),
      if(providerPoint!=null)Marker(markerId:const MarkerId('partner'),position:providerPoint!,icon:BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),infoWindow:InfoWindow(title:widget.isProvider?'You':'Gofixo Partner')),
    };
    final title=status=='ongoing'?'Trip in progress':status=='arrived'?'Partner has arrived':status=='accepted'?'Partner is on the way':'Live trip';
    return Scaffold(
      appBar:AppBar(title:Text(widget.isProvider?'Trip map':title)),
      body:Stack(children:[
        GoogleMap(
          initialCameraPosition:CameraPosition(target:center,zoom:15),
          onMapCreated:(m){mapController=m;WidgetsBinding.instance.addPostFrameCallback((_)=>_fitAllPoints());},
          onCameraMoveStarted:(){if(!movingCamera)followCamera=false;},
          gestureRecognizers:<Factory<OneSequenceGestureRecognizer>>{
            Factory<OneSequenceGestureRecognizer>(()=>EagerGestureRecognizer()),
          },
          rotateGesturesEnabled:true,
          tiltGesturesEnabled:true,
          scrollGesturesEnabled:true,
          zoomGesturesEnabled:true,
          myLocationEnabled:widget.isProvider,
          myLocationButtonEnabled:true,
          markers:markers,
          polylines:routeLines,
          zoomControlsEnabled:false,
          compassEnabled:true,
        ),
        Positioned(left:14,right:14,top:14,child:Container(
          padding:const EdgeInsets.symmetric(horizontal:14,vertical:12),
          decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:14)]),
          child:Row(children:[
            Icon(status=='ongoing'?Icons.navigation_rounded:Icons.two_wheeler,color:gfGreen),
            const SizedBox(width:10),
            Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
              Text(widget.isProvider?'Trip map':title,style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
              Text(widget.isProvider?'GPS is updating live':(status=='ongoing'?'Partner location is live':status=='arrived'?'Partner has arrived at pickup':'Partner is on the way'),style:const TextStyle(fontSize:11,color:gfMuted)),
            ])),
            IconButton(onPressed:(){setState(()=>followCamera=true);_fitAllPoints();},icon:const Icon(Icons.fit_screen,color:gfGreen)),
            if(!widget.isProvider)IconButton(onPressed:(){setState(()=>followCamera=true);_followProvider();},icon:const Icon(Icons.my_location,color:gfGreen)),
          ]),
        )),
        Positioned(left:14,right:14,bottom:18,child:Container(
          padding:const EdgeInsets.all(16),
          decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(20),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:18)]),
          child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
            Row(children:[
              Container(width:44,height:44,decoration:const BoxDecoration(shape:BoxShape.circle,color:Color(0xFFEFFFF5)),child:const Icon(Icons.navigation_rounded,color:gfGreen)),
              const SizedBox(width:12),
              Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
                Text(status=='ongoing'?'Ride in progress':status=='arrived'?'Partner has arrived':status=='accepted'?'Partner is arriving':'Live ride',style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
                Text(status=='ongoing'?'Heading to destination':'Heading to pickup',style:const TextStyle(fontSize:11,color:gfMuted)),
              ])),
            ]),
            if(routeDistanceMeters!=null||routeEtaSeconds!=null) ...[
              const SizedBox(height:14),
              Row(children:[
                Expanded(child:_LiveMetric(icon:Icons.route_rounded,label:'Distance',value:gfFormatDistance(routeDistanceMeters))),
                const SizedBox(width:10),
                Expanded(child:_LiveMetric(icon:Icons.schedule_rounded,label:'Live ETA',value:routeEtaSeconds!=null&&routeEtaSeconds!>0?gfFormatEta(routeEtaSeconds):gfEstimateEta(routeDistanceMeters))),
              ]),
            ],
          ]),
        )),
      ]),
    );
  }
}
