/*********  Hi You :D Welcome to the documentation of the Progress Bar Asset **********/
/************* Here you can find the documentation of the Progress Bar Updater Asset **************/

/**
 * So Let's start with a small introduction about the asset:
 * 
 * This asset is created by Yas AR to help you create a life/ mana / stamina / energy / ... (you can choose for any type of progress bar) for your games.
 * You can use it for enemies, players, bosses, and more.
 * 
 * If you don't want to read a lot of documentation, you can watch this video: https://youtu.be/Iux_kOnMPtA (it's a tutorial video that will help you to use the asset)
 * 
 * 
 * So this asset contains 2 types of progress bars (2 Scripts):
 * 
 * 1- Continuous Bar Updater Script: This script is used to create a progress bar that will decrease continuously (like a life bar)
 * - Using this you have a life bar that will decrease continuously (like a life bar) and you can choose the max life of the object (the amount is a integer number from 1 to 1000 max)
 * (if you need more than 1000 life, you can change the max life from the script)
 * You can also decrease the life of the object by any amount you want (you can choose the amount of the damage) 
 * To do that, you just need to call the damageEvent function from another script and send the damage amount as a parameter (pls send a integer number)
 * The damageEvent function is public so you can call it from another script by importing this script to the other script or using behavior script (call api deprecated)
 * Once you do that, the life of the object will decrease by the damage amount you sent and the life bar size will change to match the current life of the object
 * for this type of bar there is also a text that will show the current life of the object (you can leave it empty if you don't want to use it, you don't need to change anything)
 * 
 * Now you can also heal the object by calling the healEvent function from another script and send the heal amount as a parameter (pls send a integer number)
 * The healEvent function is just the same as the damageEvent function but it will increase the life of the object by the heal amount you sent
 * 
 * VERY IMPORTANT: IF YOU CHANGE THE BAR DISPLAY SIZE, YOU NEED TO CHANGE IT ON THE 2 AXIS (X AND Y) TO KEEP THE BAR IMAGE IN THE CENTER SO DON'T CHANGE ONLY ONE AXIS
 * AND IF YOU WANT TO CHANGE THE SIZE CHANGE ONLY THE SIZE OF THE WHOLE DISPLAY (THE PARENT OF THE BAR IMAGE)
 * 
 * 2- Segmented Bar Updater Script: This script is used to create a progress bar that will decrease by segments (like a heart bar)
 * - Using this you have a life bar that will decrease by segments (it will remove a life bar every time you call the damageEvent function (depending on the damage amount you send))
 * - So about this script, you can choose the amount of the life bars by adding the bar images to the lifeBars array (you can add as many as you want)
 * Of course if you want to add them you need to create them (you can duplicate the exsiting ones )
 * 
 * So if you want to damage the object, you just need to call the damageEvent function from another script and send the damage amount as a parameter (pls send a integer number)
 * becareful, every amount is a life bar (a hearth) (so if you send 2, it will decrease 2 life bars) and when you have no more life bars, the object will die (i just printed a message to the console)
 * but you can add your own code to do something else when the object die
 * The damageEvent function is public so you can call it from another script by importing this script to the other script or using behavior script (call api deprecated)
 * 
 * Now you can also heal the object by calling the healEvent function from another script and send the heal amount as a parameter (pls send a integer number)
 * The healEvent function is just the same as the damageEvent function but it will increase the life of the object by the heal amount you sent
 * 
 * VERY IMPORTANT: IF YOU CHANGE THE BAR DISPLAY SIZE, YOU NEED TO CHANGE IT ON THE 2 AXIS (X AND Y) TO KEEP THE BAR IMAGE IN THE CENTER SO DON'T CHANGE ONLY ONE AXIS
 * AND IF YOU WANT TO CHANGE THE SIZE CHANGE ONLY THE SIZE OF THE WHOLE DISPLAY (THE PARENT OF THE BAR IMAGE) 
 * 
**/
// NOTE: Choose the type of bar you want to use and delete the other one (you can also keep every bar you need if you want to use them in different objects)
/**
 * Folders and Files structure:
 * 
 * Textures Folder: This folder contains the textures used in the asset, The bar images (the images are all white) in png format and they are classified by different designs (desing1, design2, design3, ...)
 * 
 * Materials Folder: This folder contains the materials used in the asset, every bar design has a own material (Because the bar images are white, you can change the color of the bar by changing the color of the material)
 *          
 * Scripts Folder: This folder contains the scripts used in the asset, The 2 scripts are in this folder (ContinuousBarUpdater.cs and SegmentedBarUpdater.cs) it also contains the documentation script
 * 
 * 
 * 
 */


/**
 * 
 * So I hope this documentation will help you to use the asset, if you need more help to understand how to use it, you can watch this video: https://youtu.be/Iux_kOnMPtA
 * Maybe it will help you to better understand how to use the asset
 * 
 * Now if you still have any question, you can contact me on my social media accounts :D
 * 
 * I am always online on Discord so you can contact me there: yassine3945
 * (if you are on the Snap AR or LensList server, you can just ping me there i will help you :D)
 * 
 * You can also contact me via my social media accounts:
 * My Link Tree: https://linktr.ee/yassar_xr
 * 
 * Don't Hesitate to contact me if you have any question or if you need help with anything :D
 * I will be happy to help you :>
 * 
 *  
**/


