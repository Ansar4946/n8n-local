<?php
/**
 * Plugin Name: Blog Automation SEO Meta (REST)
 * Description: Lets the n8n workflow save the SEO title, meta description and focus keyword
 *              of a post through the REST API (Yoast SEO and Rank Math). Without this the
 *              fields stay empty ("Description: Missing") because these meta keys are private.
 *
 * Install: copy this file to  wp-content/mu-plugins/seo-meta-rest.php  (create the mu-plugins
 * folder if it does not exist). Must-use plugins load automatically, no activation needed.
 */
add_action('init', function () {
    $keys = array(
        // Yoast SEO
        '_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw',
        // Rank Math
        'rank_math_title', 'rank_math_description', 'rank_math_focus_keyword',
    );
    foreach ($keys as $key) {
        register_post_meta('post', $key, array(
            'show_in_rest'  => true,
            'single'        => true,
            'type'          => 'string',
            'auth_callback' => function () { return current_user_can('edit_posts'); },
        ));
    }
});
